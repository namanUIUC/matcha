import type OpenAI from "openai";

// ---------------------------------------------------------------------------
// Job database
// ---------------------------------------------------------------------------
// Mirrors the shape you shared. `description` is HTML; the "requirements" live
// inside that markup rather than in a structured field, which is why the LLM
// reading the JD is doing real work. `compensation` may be absent (your UI
// hides empty salary ranges), so we treat missing comp as "unknown", not a
// failed filter.

export type LocationType = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type JobStatus = "live" | "draft" | "closed" | string;

export interface Compensation {
  /** Display label, e.g. "Estimated Base Salary". */
  label?: string;
  /** Amount. NOTE: per-year for salaried roles, but per-hour for contract/intern
   *  (e.g. 90–140). The `period` field disambiguates — don't compare across periods. */
  min?: number;
  max?: number;
  currency?: string;
  /** e.g. "per year" | "per hour". */
  period?: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  /** HTML. Stripped before being sent to the model. */
  description: string;
  location: string;
  locationType: LocationType;
  department?: string;
  employmentType: EmploymentType;
  publishedAt?: string;
  compensation?: Compensation;
  status: JobStatus;
  // applicationConfig and other employer-side fields are ignored for matching.
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Candidate profile
// ---------------------------------------------------------------------------
// Two halves: (1) PREFERENCES — what the candidate wants (location, comp, type)
// plus the hard dealbreakers, and (2) the RESUME — who the candidate actually
// is (summary, work history, skills). The hard filter in `filters.ts` reads only
// the preferences/dealbreakers; the whole object is also handed to the LLM
// verbatim, so the resume fields below directly inform the match. Unknown fields
// still flow through (`[key: string]: unknown`), so a richer real profile slots
// in without code changes.

/** One role from the candidate's resume — the substance the model should weigh. */
export interface WorkExperience {
  title: string;
  company: string;
  /** Free-form, e.g. "2021–2024" or "3 yrs". The model reads it as-is. */
  dates?: string;
  /** What they built/owned. This is the high-signal part — keep it concrete. */
  summary?: string;
  skills?: string[];
}

export interface CandidateProfile {
  name?: string;
  /** Roles/titles the candidate is targeting. */
  desiredRoles?: string[];
  seniority?: string; // e.g. "senior", "staff", "junior"
  yearsExperience?: number;
  skills?: string[];

  // --- Resume / experience (high-signal; weighed alongside the transcript) ---
  /** One-line headline from the top of the resume. */
  headline?: string;
  /** Free-text professional summary / objective. */
  summary?: string;
  /** Structured work history parsed from the resume. */
  workHistory?: WorkExperience[];
  /** Raw resume text, when that's all you have — handed to the model verbatim. */
  resumeText?: string;
  location?: {
    city?: string;
    /** What the candidate will accept. "any" = no preference. */
    remotePreference?: LocationType | "any";
  };
  salaryExpectation?: {
    /** Minimum acceptable base. */
    min?: number;
    currency?: string;
  };
  employmentTypePreference?: EmploymentType | "any";
  /**
   * Things the candidate flat-out won't accept. These drive the hard filter in
   * `filters.ts` — keep this distinct from the soft preferences above.
   */
  dealbreakers?: {
    remoteOnly?: boolean;
    fullTimeOnly?: boolean;
    /** Won't consider anything below this base salary. */
    minSalary?: number;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Intake transcript (LiveKit conversation)
// ---------------------------------------------------------------------------
// LiveKit Agents give you the conversation as ordered chat turns. Keep them as
// turns rather than one flattened blob — the agent's questions give context to
// the candidate's answers, which is exactly the signal we want the model to use.

export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  timestamp?: string;
}

export type Transcript = TranscriptTurn[];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface JobMatch {
  job: Job;
  /** 0–100, the model's confidence that this candidate fits this job. */
  matchScore: number;
  /** Short, candidate-facing explanation of why it's a match. */
  reason: string;
  /** Optional caveat the recruiter/candidate should know (e.g. "salary slightly below ask"). */
  concern?: string;
}

export interface RecommendationResult {
  matches: JobMatch[];
  /** Jobs dropped before the LLM by the hard filter, with the reason. */
  filteredOut: { jobId: string; reason: string }[];
  /** True when nothing cleared the relevance bar — surface this to the recruiter. */
  noStrongMatch: boolean;
  /** Token usage for the LLM call — inspect prompt_tokens_details.cached_tokens to confirm caching. Absent if the hard filter dropped everything (no call made). */
  usage?: OpenAI.CompletionUsage;
}
