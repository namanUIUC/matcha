import type { Job } from "./types.js";

const DEMO_JOBS_URL =
  "https://fantastic-dolphin-367.convex.site/api/job-board/demo-jobs";

interface JobBoardResponse {
  success: boolean;
  results: Job[];
}

/**
 * Fetch the job catalog from the Convex job-board endpoint. The endpoint wraps
 * the array in `{ success, results }`; we unwrap and hand back `Job[]` ready for
 * `recommendJobs`. The hard filter drops non-`live` statuses (paused/closed)
 * downstream, so no need to filter here.
 */
export async function fetchJobs(url: string = DEMO_JOBS_URL): Promise<Job[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Job board fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as JobBoardResponse;
  if (!body.success || !Array.isArray(body.results)) {
    throw new Error("Job board returned an unexpected payload shape.");
  }
  return body.results;
}
