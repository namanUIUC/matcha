import OpenAI from "openai";
import { stripHtml } from "./jobs.js";
import { hardFilterReason } from "./filters.js";
import type { CandidateProfile, Job, Transcript } from "./types.js";

// ---------------------------------------------------------------------------
// SEMANTIC SEARCH — an alternative to the LLM rank-and-explain in recommend.ts.
//
// Instead of asking a model to reason over the catalog, we embed the candidate
// (profile + resume + transcript) and each job into vectors and rank jobs by
// cosine similarity to the candidate. It's much cheaper and faster (one
// embeddings call, no generation), but it ranks on *topical overlap*, not
// genuine fit — it can't reason that "wants to leave infra" should push an
// infra role DOWN, and it returns no human-readable reason or fit score.
//
// We reuse the SAME hard filter as recommend.ts so the two approaches are
// compared on an identical candidate pool.
// ---------------------------------------------------------------------------

// Gemini's embedding model, served through the OpenAI-compatible endpoint.
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";

const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai/";

export interface SemanticMatch {
  job: Job;
  /** Cosine similarity in [-1, 1]; higher = closer. NOT a 0-100 fit score. */
  similarity: number;
}

export interface SemanticResult {
  matches: SemanticMatch[];
  /** Jobs dropped before embedding by the shared hard filter, with the reason. */
  filteredOut: { jobId: string; reason: string }[];
}

export interface SemanticOptions {
  profile: CandidateProfile;
  transcript: Transcript;
  jobs: Job[];
  /** Max matches to return. Default 2. */
  topN?: number;
  /** Inject your own client (configured key, base URL, etc.). */
  client?: OpenAI;
}

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Flatten the candidate into the text we embed. We fold in the resume and the
 * transcript because that's where the real signal lives — embedding only the
 * structured prefs would collapse very different candidates onto each other.
 */
function candidateText(profile: CandidateProfile, transcript: Transcript): string {
  const transcriptText = transcript
    .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");
  return [
    "CANDIDATE PROFILE:",
    JSON.stringify(profile),
    "",
    "INTAKE CALL TRANSCRIPT:",
    transcriptText,
  ].join("\n");
}

/** The text we embed for each job — title, meta, and the stripped JD. */
function jobText(job: Job): string {
  const c = job.compensation;
  const comp =
    c && (c.min != null || c.max != null)
      ? `Compensation: ${c.min ?? "?"}–${c.max ?? "?"} ${c.currency ?? "USD"} ${c.period ?? "per year"}`
      : "";
  return [
    `${job.title} @ ${job.company}`,
    `${job.location} (${job.locationType}) · ${job.employmentType}` +
      (job.department ? ` · ${job.department}` : ""),
    comp,
    stripHtml(job.description),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function semanticRecommendJobs(
  opts: SemanticOptions,
): Promise<SemanticResult> {
  const { profile, transcript, jobs, topN = 2 } = opts;
  const client =
    opts.client ??
    new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: GEMINI_BASE_URL,
    });

  // 1. Same hard filter as the LLM path — identical candidate pool.
  const filteredOut: SemanticResult["filteredOut"] = [];
  const candidates: Job[] = [];
  for (const job of jobs) {
    const reason = hardFilterReason(job, profile);
    if (reason) filteredOut.push({ jobId: job.id, reason });
    else candidates.push(job);
  }
  if (candidates.length === 0) return { matches: [], filteredOut };

  // 2. One batched embeddings call: candidate first, then every job. Index 0 is
  //    the query; the rest line up with `candidates` by index.
  const inputs = [
    candidateText(profile, transcript),
    ...candidates.map(jobText),
  ];
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: inputs,
  });

  // The API may return results out of order — sort by `index` before using.
  const vectors = res.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding as number[]);
  const [queryVec, ...jobVecs] = vectors;

  // 3. Rank by cosine similarity, best first, trim to topN.
  const matches = candidates
    .map((job, i): SemanticMatch => ({
      job,
      similarity: cosineSimilarity(queryVec ?? [], jobVecs[i] ?? []),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);

  return { matches, filteredOut };
}
