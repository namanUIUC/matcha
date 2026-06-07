import OpenAI from "openai";
import { formatCatalog } from "./jobs.js";
import { clearsRelevanceBar, hardFilterReason } from "./filters.js";
import type {
  CandidateProfile,
  Job,
  JobMatch,
  RecommendationResult,
  Transcript,
} from "./types.js";

// Gemini 3.5 Flash: fast, cheap, and strong enough for rank-and-explain over
// ~20 jobs. Override per-environment with GEMINI_MODEL (e.g. a Pro model).
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// The system instructions are stable across every candidate, so they sit at the
// front of the cacheable prefix (tools -> system -> messages render order).
const SYSTEM_INSTRUCTIONS = `You are a job-matching engine for a hiring product.

You are given a CANDIDATE PROFILE, the transcript of the candidate's intake
call, and a CATALOG of open jobs. Rank how well the candidate fits each job and
return the best matches.

Guidelines:
- Weigh the transcript heavily. It captures intent, soft preferences, and
  dealbreakers the structured profile may not — e.g. "I'd take less pay for
  remote" or "I'm burned out on early-stage startups".
- Weigh the candidate's RESUME just as heavily: their summary, work history
  (titles held, what they actually built/owned), years of experience, and
  skills. A genuine fit needs the demonstrated experience to back it up, not
  just stated interest — match what they've *done* against what the job needs.
- The job requirements live inside each Description; read them.
- Score each job 0-100 for genuine fit (skills, seniority, location/remote,
  compensation, and what the candidate actually said they want).
- Be honest and selective. This protects hiring managers from irrelevant
  candidates: if nothing is a strong fit, say so by returning few or no matches
  rather than padding the list. Do NOT recommend a job you scored below 60.
- Each reason must be one or two sentences, candidate-facing, and cite something
  concrete from their profile or the call.
- Refer to jobs by the [id] shown in brackets.`;

const TOOL_NAME = "submit_recommendations";

const RECOMMENDATION_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Submit the ranked job matches for this candidate. Return at most the requested number, " +
      "ordered best-first. Omit any job that is not a genuine fit.",
    parameters: {
      type: "object",
      properties: {
        recommendations: {
          type: "array",
          description: "Best matches, best first. May be empty if nothing fits well.",
          items: {
            type: "object",
            properties: {
              jobId: { type: "string", description: "The [id] of the job." },
              matchScore: {
                type: "integer",
                description: "0-100 genuine-fit score for this candidate.",
              },
              reason: {
                type: "string",
                description:
                  "1-2 sentences, candidate-facing, citing something concrete from the profile or call.",
              },
              concern: {
                type: "string",
                description:
                  "Optional caveat the recruiter/candidate should know (e.g. salary below ask).",
              },
            },
            required: ["jobId", "matchScore", "reason"],
          },
        },
        noStrongMatch: {
          type: "boolean",
          description: "True if no job is a strong fit for this candidate.",
        },
      },
      required: ["recommendations", "noStrongMatch"],
    },
  },
};

interface RawRec {
  jobId: string;
  matchScore: number;
  reason: string;
  concern?: string;
}
interface ToolInput {
  recommendations: RawRec[];
  noStrongMatch: boolean;
}

export interface RecommendOptions {
  profile: CandidateProfile;
  transcript: Transcript;
  jobs: Job[];
  /** Max matches to return. Default 2. We may return fewer if quality is low. */
  topN?: number;
  /** Inject your own client (configured key, base URL, etc.). */
  client?: OpenAI;
}

function buildUserContent(
  profile: CandidateProfile,
  transcript: Transcript,
  topN: number,
): string {
  const transcriptText = transcript
    .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");

  return [
    "CANDIDATE PROFILE (JSON):",
    JSON.stringify(profile, null, 2),
    "",
    "INTAKE CALL TRANSCRIPT:",
    transcriptText,
    "",
    `Return your top ${topN} job matches (fewer if fewer are a genuine fit), best first.`,
  ].join("\n");
}

export async function recommendJobs(
  opts: RecommendOptions,
): Promise<RecommendationResult> {
  const { profile, transcript, jobs, topN = 2 } = opts;
  const client =
    opts.client ??
    new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL:
        process.env.GEMINI_BASE_URL ??
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    });

  // 1. Hard filter — drop dealbreakers and non-live jobs before spending tokens.
  const filteredOut: RecommendationResult["filteredOut"] = [];
  const candidates: Job[] = [];
  for (const job of jobs) {
    const reason = hardFilterReason(job, profile);
    if (reason) filteredOut.push({ jobId: job.id, reason });
    else candidates.push(job);
  }

  if (candidates.length === 0) {
    return { matches: [], filteredOut, noStrongMatch: true };
  }

  // 2. Single LLM call. The system message carries the stable instructions +
  //    catalog. We keep the catalog as the tail of the system message so it
  //    forms a stable prefix Gemini can cache across candidates; unlike
  //    Anthropic, there's no explicit cache breakpoint to set — Gemini caches
  //    implicitly once the prefix clears its minimum cacheable size.
  const response = await client.chat.completions.create({
    model: MODEL,
    // Headroom for reasoning models (Gemini 3 Pro): hidden "thinking" tokens
    // draw from this budget, so a tight cap can truncate the forced tool call.
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          `${SYSTEM_INSTRUCTIONS}\n\n` +
          `JOB CATALOG (${candidates.length} live jobs):\n\n${formatCatalog(candidates)}`,
      },
      { role: "user", content: buildUserContent(profile, transcript, topN) },
    ],
    tools: [RECOMMENDATION_TOOL],
    tool_choice: { type: "function", function: { name: TOOL_NAME } }, // force structured output
  });

  // 3. Pull the forced tool call out of the response and parse its JSON args.
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (
    !toolCall ||
    toolCall.type !== "function" ||
    toolCall.function.name !== TOOL_NAME
  ) {
    throw new Error("Model did not return a recommendations tool call.");
  }
  const result = JSON.parse(toolCall.function.arguments) as ToolInput;

  // 4. Map ids back to jobs, drop anything that hallucinated an id, apply the
  //    relevance bar, sort, and trim to topN.
  const byId = new Map(candidates.map((j) => [j.id, j]));
  const scored: JobMatch[] = (result.recommendations ?? [])
    .map((r): JobMatch | null => {
      const job = byId.get(r.jobId);
      if (!job) return null;
      const match: JobMatch = { job, matchScore: r.matchScore, reason: r.reason };
      if (r.concern) match.concern = r.concern;
      return match;
    })
    .filter((m): m is JobMatch => m !== null)
    .sort((a, b) => b.matchScore - a.matchScore);

  const bestScore = scored[0]?.matchScore ?? 0;
  const matches = scored
    .filter((m) => clearsRelevanceBar(m, bestScore))
    .slice(0, topN);

  return {
    matches,
    filteredOut,
    noStrongMatch: matches.length === 0 || result.noStrongMatch === true,
    usage: response.usage,
  };
}
