import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

type ProfileDoc = Doc<"careerProfiles">;
type JobDoc = Doc<"jobs">;

type Scored = {
  job: JobDoc;
  score: number;
  reasons: string[];
};

const norm = (s: string) => s.trim().toLowerCase();
const tokens = (xs: string[] | undefined) =>
  new Set((xs ?? []).map(norm).filter(Boolean));

// Noise words we filter out of role / work-pref token sets so they don't act
// as match signal on their own (e.g. profile says "designer roles", we want
// "designer" to match, not "roles").
const NOISE_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "roles",
  "role",
  "jobs",
  "job",
  "work",
  "position",
  "positions",
]);

function tokenize(s: string | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .split(/[\s,/_-]+/)
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t));
}

function tokenSet(xs: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const x of xs ?? []) {
    for (const t of tokenize(x)) out.add(t);
  }
  return out;
}

function scoreJob(profile: ProfileDoc, job: JobDoc): Scored {
  // Skills stay exact-token matches (lowercased) — fuzzy / typo handling is
  // out of scope; the LLM should be transcribing skills accurately.
  const profileSkills = tokens(profile.skills);
  // Roles, work prefs are tokenized so phrases like "designer roles" or
  // "remote roles" match "Designer" / "remote".
  const profileRoleTokens = tokenSet(profile.preferredRoles);
  const profileWorkTokens = tokenSet(profile.workPreferences);
  const profileLocations = tokens(profile.locationPreferences);

  const jobSkills = tokens(job.skills);
  const jobTitleTokens = new Set(tokenize(job.title));
  const jobRoleCategoryTokens = new Set(tokenize(job.roleCategory));
  const jobLocation = norm(job.location);
  const jobRemote = norm(job.remoteType ?? "");

  const reasons: string[] = [];
  let score = 0;

  for (const skill of profileSkills) {
    if (jobSkills.has(skill)) {
      score += 3;
      reasons.push(`skill match: ${skill}`);
    }
  }

  // Role: any non-noise token from the caller's preferred roles that appears
  // in the job title or role category counts once.
  const matchedRoles = new Set<string>();
  for (const tok of profileRoleTokens) {
    if (jobTitleTokens.has(tok) || jobRoleCategoryTokens.has(tok)) {
      matchedRoles.add(tok);
    }
  }
  for (const tok of matchedRoles) {
    score += 2;
    reasons.push(`role match: ${tok}`);
  }

  for (const loc of profileLocations) {
    if (jobLocation.includes(loc)) {
      score += 1;
      reasons.push(`location match: ${loc}`);
    }
  }

  // Remote: tokenize work prefs first so phrases like "remote roles" or
  // "fully remote" register the same as a bare "remote".
  if (jobRemote === "remote" && profileWorkTokens.has("remote")) {
    score += 1;
    reasons.push("remote work preference");
  }

  return { job, score, reasons };
}

export const recommendJobs = internalAction({
  args: {
    phoneNumber: v.string(),
    topN: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    profileFound: boolean;
    recommendations: Array<{
      jobId: Id<"jobs">;
      title: string;
      company: string;
      location: string;
      remoteType?: string;
      score: number;
      reasons: string[];
    }>;
    exhausted: boolean;
  }> => {
    const topN = args.topN ?? 3;
    console.log("[recommendJobs] action start", {
      phoneNumber: args.phoneNumber,
      topN,
    });

    const profile = await ctx.runQuery(
      internal.careerProfiles.read._getByPhoneInternal,
      { phoneNumber: args.phoneNumber },
    );
    if (!profile) {
      console.warn("[recommendJobs] profile not found", args.phoneNumber);
      return { profileFound: false, recommendations: [], exhausted: false };
    }
    console.log("[recommendJobs] profile loaded", {
      id: profile._id,
      hasSkills: (profile.skills?.length ?? 0) > 0,
      hasPreferredRoles: (profile.preferredRoles?.length ?? 0) > 0,
    });

    const seedResult = await ctx.runMutation(
      internal.careerProfiles.jobs.seedDemoJobsIfEmpty,
      {},
    );
    console.log("[recommendJobs] seed check", seedResult);

    const [allJobs, alreadyIds] = await Promise.all([
      ctx.runQuery(internal.careerProfiles.jobs.listAllJobs, {}),
      ctx.runQuery(internal.careerProfiles.jobs.listRecommendedJobIds, {
        careerProfileId: profile._id,
      }),
    ]);
    console.log("[recommendJobs] data loaded", {
      totalJobs: allJobs.length,
      alreadyRecommended: alreadyIds.length,
    });

    const seen = new Set(alreadyIds.map((id: Id<"jobs">) => id as string));
    const fresh = allJobs.filter((j: JobDoc) => !seen.has(j._id as string));

    // Always return up to `topN` (2-3) recommendations regardless of how strong
    // the matches are — a sparse profile shouldn't yield zero recs. Zero-score
    // jobs are still useful exposure for the caller to react to. The dedup
    // ledger (`jobRecommendations`) guarantees we won't keep showing the same
    // weak picks on subsequent calls.
    const scored = fresh
      .map((j: JobDoc) => scoreJob(profile, j))
      .sort((a: Scored, b: Scored) => {
        if (b.score !== a.score) return b.score - a.score;
        // Stable tie-breaker so the response order is deterministic per call
        // but varies across the dataset (newer jobs first).
        return b.job._creationTime - a.job._creationTime;
      });
    const ranked = scored.slice(0, topN);

    console.log("[recommendJobs] ranking", {
      freshCandidates: fresh.length,
      returning: ranked.length,
      topScores: ranked.map((s: Scored) => s.score),
      anyPositive: ranked.some((s: Scored) => s.score > 0),
    });

    if (ranked.length === 0) {
      // Only happens when every job has already been recommended for this
      // profile (fresh.length === 0). Genuine "ran out of jobs" case.
      return {
        profileFound: true,
        recommendations: [],
        exhausted: true,
      };
    }

    await ctx.runMutation(internal.careerProfiles.jobs.saveRecommendations, {
      careerProfileId: profile._id,
      items: ranked.map((s: Scored) => ({
        jobId: s.job._id,
        score: s.score,
        reasons: s.reasons,
      })),
    });
    console.log("[recommendJobs] saved recs", { count: ranked.length });

    return {
      profileFound: true,
      recommendations: ranked.map((s: Scored) => ({
        jobId: s.job._id,
        title: s.job.title,
        company: s.job.company,
        location: s.job.location,
        remoteType: s.job.remoteType,
        score: s.score,
        reasons: s.reasons,
      })),
      exhausted: false,
    };
  },
});
