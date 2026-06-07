import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";

const UNSILOED_BASE = "https://prod.visionapi.unsiloed.ai";

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Full name of the candidate at the top of the resume.",
    },
    summary: {
      type: "string",
      description:
        "A short, 1-2 sentence professional summary written in the candidate's voice. If the resume has no summary section, synthesize one from the most senior role and headline skills.",
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete technical and professional skills, tools, languages, frameworks, and platforms the candidate has used. Each entry is a short noun phrase like 'python', 'react', 'kubernetes'. Do not include soft skills.",
    },
    experience: {
      type: "array",
      items: { type: "string" },
      description:
        "Each work experience entry as one sentence in the form 'Title at Company (years) — what they did'. Include internships and contract roles. Most-recent first.",
    },
    education: {
      type: "array",
      items: { type: "string" },
      description:
        "Each education entry as one sentence in the form 'Degree, Institution (year)'. Include noteworthy honors or activities inline.",
    },
    interests: {
      type: "array",
      items: { type: "string" },
      description:
        "Industries, domains, or topics the candidate signals interest in (from a Projects, Interests, or Volunteer section). Empty array if not present.",
    },
    preferred_roles: {
      type: "array",
      items: { type: "string" },
      description:
        "Job titles the candidate is likely targeting next, inferred from their most recent roles and any 'Objective' or 'Looking for' line. Examples: 'staff software engineer', 'product designer'.",
    },
    location_preferences: {
      type: "array",
      items: { type: "string" },
      description:
        "Cities or regions named on the resume (current location, willingness to relocate). Empty array if not stated.",
    },
    work_preferences: {
      type: "array",
      items: { type: "string" },
      description:
        "Work-style preferences if stated: 'remote', 'hybrid', 'onsite', 'full-time', 'contract'. Empty array if not stated.",
    },
  },
  required: [
    "name",
    "summary",
    "skills",
    "experience",
    "education",
    "interests",
    "preferred_roles",
    "location_preferences",
    "work_preferences",
  ],
  additionalProperties: false,
} as const;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
}

function unionList(a?: string[], b?: string[]): string[] | undefined {
  const out = new Set<string>();
  for (const x of a ?? []) if (x) out.add(x);
  for (const x of b ?? []) if (x) out.add(x);
  return out.size > 0 ? Array.from(out) : undefined;
}

// Mint a one-shot upload URL the browser can POST the resume PDF to. Auth-gated
// so only signed-in users can stash files in our Convex storage bucket.
export const generateResumeUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const _getMyPhone = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return user?.phone ?? null;
  },
});

const profileFieldsValidator = {
  phoneNumber: v.string(),
  name: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
  experience: v.optional(v.array(v.string())),
  education: v.optional(v.array(v.string())),
  interests: v.optional(v.array(v.string())),
  preferredRoles: v.optional(v.array(v.string())),
  locationPreferences: v.optional(v.array(v.string())),
  workPreferences: v.optional(v.array(v.string())),
  summary: v.optional(v.string()),
};

// Patch the existing profile (or insert one) with resume-derived fields.
// For list fields we union with whatever the phone interview already captured
// so importing a resume never erases prior context; for scalars we prefer the
// resume value when present and otherwise keep what's already there.
export const _mergeResumeFields = internalMutation({
  args: profileFieldsValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("careerProfiles")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .unique();

    const merged: Partial<Doc<"careerProfiles">> = {
      phoneNumber: args.phoneNumber,
    };

    const name = args.name ?? existing?.name;
    if (name) merged.name = name;

    const summary = args.summary ?? existing?.summary;
    if (summary) merged.summary = summary;

    const lists: Array<keyof typeof args & keyof Doc<"careerProfiles">> = [
      "skills",
      "experience",
      "education",
      "interests",
      "preferredRoles",
      "locationPreferences",
      "workPreferences",
    ];
    for (const key of lists) {
      const u = unionList(
        existing?.[key] as string[] | undefined,
        args[key] as string[] | undefined,
      );
      if (u) (merged as Record<string, unknown>)[key] = u;
    }

    if (existing) {
      await ctx.db.patch(existing._id, merged);
      return existing._id;
    }
    return await ctx.db.insert("careerProfiles", merged);
  },
});

type UnsiloedJob = {
  status?: string;
  message?: string;
  // Unsiloed has shipped multiple response shapes; tolerate the common ones.
  data?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
  result?: Record<string, unknown>;
  extracted?: Record<string, unknown>;
};

function pickExtracted(body: UnsiloedJob): Record<string, unknown> {
  return (
    body.data ??
    body.extraction ??
    body.extracted ??
    body.result ??
    {}
  );
}

type EnrichResult = {
  ok: true;
  extracted: {
    phoneNumber: string;
    name?: string;
    summary?: string;
    skills?: string[];
    experience?: string[];
    education?: string[];
    interests?: string[];
    preferredRoles?: string[];
    locationPreferences?: string[];
    workPreferences?: string[];
  };
};

export const enrichFromResume = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<EnrichResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const phoneNumber: string | null = await ctx.runQuery(
      internal.careerProfiles.enrich._getMyPhone,
      {},
    );
    if (!phoneNumber) {
      throw new Error(
        "Your account has no phone number — call Matcha first so we know who you are.",
      );
    }

    const apiKey = process.env.UNSILOED_API_KEY;
    if (!apiKey) {
      throw new Error(
        "UNSILOED_API_KEY is not configured on this Convex deployment.",
      );
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Uploaded file is missing or expired.");

    const form = new FormData();
    form.append("pdf_file", blob, "resume.pdf");
    form.append("schema_data", JSON.stringify(RESUME_SCHEMA));

    const submit = await fetch(`${UNSILOED_BASE}/v2/extract`, {
      method: "POST",
      headers: { "api-key": apiKey, accept: "application/json" },
      body: form,
    });
    if (!submit.ok) {
      const text = await submit.text();
      throw new Error(
        `Unsiloed submit failed: ${submit.status} ${text.slice(0, 300)}`,
      );
    }
    const submitBody = (await submit.json()) as { job_id?: string };
    const jobId = submitBody.job_id;
    if (!jobId) throw new Error("Unsiloed did not return a job_id");

    let extracted: Record<string, unknown> | null = null;
    const maxAttempts = 60; // ~5 minutes at 5s intervals.
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(`${UNSILOED_BASE}/extract/${jobId}`, {
        method: "GET",
        headers: { "api-key": apiKey, accept: "application/json" },
      });
      if (!poll.ok) continue;
      const body = (await poll.json()) as UnsiloedJob;
      const status = (body.status ?? "").toLowerCase();
      if (status === "succeeded" || status === "completed") {
        extracted = pickExtracted(body);
        break;
      }
      if (status === "failed" || status === "error") {
        throw new Error(
          `Unsiloed parse failed: ${body.message ?? "unknown error"}`,
        );
      }
    }
    if (!extracted) {
      throw new Error("Resume parse timed out — try again in a moment.");
    }

    const merged: EnrichResult["extracted"] = {
      phoneNumber,
      name: asString(extracted.name),
      summary: asString(extracted.summary),
      skills: asStringArray(extracted.skills),
      experience: asStringArray(extracted.experience),
      education: asStringArray(extracted.education),
      interests: asStringArray(extracted.interests),
      preferredRoles: asStringArray(extracted.preferred_roles),
      locationPreferences: asStringArray(extracted.location_preferences),
      workPreferences: asStringArray(extracted.work_preferences),
    };

    await ctx.runMutation(
      internal.careerProfiles.enrich._mergeResumeFields,
      merged,
    );

    // The resume file is no longer needed; the extracted fields live on the
    // profile row. Drop it so we don't accumulate orphan blobs.
    try {
      await ctx.storage.delete(args.storageId);
    } catch {
      // Non-fatal — log via Convex automatically and continue.
    }

    return {
      ok: true,
      extracted: merged,
    };
  },
});
