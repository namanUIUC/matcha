import type { CandidateProfile, Job, JobMatch } from "./types.js";

/**
 * HARD FILTER — runs *before* the LLM.
 *
 * Drops jobs the candidate has explicitly said no to. Keeping this cheap and
 * deterministic means we never spend tokens reasoning about jobs that can't
 * possibly work, and the candidate's stated dealbreakers are honored exactly
 * rather than left to the model's judgment.
 *
 * Returns null if the job passes, or a human-readable reason if it's dropped.
 */
export function hardFilterReason(
  job: Job,
  profile: CandidateProfile,
): string | null {
  if (job.status !== "live") return "job is not live";

  const db = profile.dealbreakers ?? {};

  if (db.remoteOnly && job.locationType !== "remote") {
    return `candidate is remote-only; job is ${job.locationType}`;
  }

  if (db.fullTimeOnly && job.employmentType !== "full_time") {
    return `candidate wants full-time; job is ${job.employmentType}`;
  }

  // Salary: only filter when the job DISCLOSES a max below the floor. Missing
  // comp is "unknown", not a failure — we let it through and let the LLM/recruiter
  // weigh it, matching your "empty ranges are never shown" behavior.
  if (db.minSalary != null) {
    const max = job.compensation?.max;
    if (max != null && max < db.minSalary) {
      return `job max ${max} is below candidate floor ${db.minSalary}`;
    }
  }

  return null;
}

/**
 * RELEVANCE BAR — runs *after* the LLM has scored the survivors.
 *
 * This is the lever for your two-sided goal: you don't just want to hand the
 * candidate their best 2 jobs, you want to avoid sending hiring managers
 * irrelevant applicants. So a job should only surface if it's *actually* a
 * decent fit — otherwise we return fewer than `topN`, or nothing.
 *
 * Strategy: a combo of an absolute floor + a relative gap + a concern penalty.
 * A job surfaces only if ALL hold:
 *   1. It clears an absolute floor — so a uniformly weak batch returns nothing
 *      rather than the "best of a bad bunch". This is the main protection for
 *      hiring managers.
 *   2. It's within RELATIVE_GAP points of the best match in the batch — so a
 *      mediocre #2 can't ride in on a strong #1.
 *   3. If the model flagged a `concern`, it must clear a higher bar — a caveat
 *      ("salary below ask", "thin on X") is tolerable on a great match but
 *      should knock out a borderline one.
 *
 * All three knobs are tunable below.
 */
export const MIN_MATCH_SCORE = 60; // absolute floor
export const RELATIVE_GAP = 15; // must be within this many points of the top match
export const CONCERN_PENALTY = 10; // a flagged concern raises the effective floor by this much

export function clearsRelevanceBar(match: JobMatch, bestScoreInBatch: number): boolean {
  const effectiveFloor = MIN_MATCH_SCORE + (match.concern ? CONCERN_PENALTY : 0);
  if (match.matchScore < effectiveFloor) return false;
  if (match.matchScore < bestScoreInBatch - RELATIVE_GAP) return false;
  return true;
}
