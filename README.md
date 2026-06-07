# matcha-reco

Job recommendation engine for a voice-based hiring product. Takes a candidate
profile + intake-call transcript, ranks open jobs, and returns the top matches
with a short reason for each.

## How it works

```
jobs ──► hard filter (filters.ts) ──► live + dealbreaker-safe candidates
                                            │
profile + transcript ───────────────────────┤
                                            ▼
                              single Haiku call (recommend.ts)
                          system = instructions + job catalog  ← cached
                          user   = profile + transcript        ← varies
                          forced tool call = structured output
                                            │
                                            ▼
                       relevance bar (filters.ts) ──► top N matches + reasons
```

- **Hard filter first.** Non-live jobs and the candidate's explicit dealbreakers
  (remote-only, full-time-only, salary floor) are dropped deterministically
  before any tokens are spent. Missing compensation is treated as "unknown,"
  not a failure.
- **One LLM call.** Claude Haiku 4.5 reads the profile, the transcript (heavily —
  that's where intent lives), and the JD requirements, then scores each job.
- **Structured output via forced tool use.** A single `submit_recommendations`
  tool with `tool_choice` guarantees typed results — no prose parsing.
- **Prompt caching.** The job catalog + instructions live in `system` with a
  cache breakpoint, so across a batch of candidates the catalog is billed at
  ~0.1× after the first call. Check `cache_read_input_tokens` to confirm.
- **Two-sided matching.** It won't pad the list — if nothing clears the
  relevance bar it returns fewer matches (or none) and sets `noStrongMatch`,
  protecting hiring managers from irrelevant candidates.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or copy .env.example to .env
npm run demo
```

## Use it in your app

```ts
import { recommendJobs } from "./src/recommend.js";

const result = await recommendJobs({
  profile,        // CandidateProfile
  transcript,     // LiveKit turns: [{ role, text }]
  jobs,           // Job[] from your DB
  topN: 2,
});
// result.matches: [{ job, matchScore, reason, concern? }]
// result.noStrongMatch, result.filteredOut, result.usage
```

## Files

| File | Purpose |
| --- | --- |
| `src/types.ts` | Data contract (Job / CandidateProfile / Transcript / result). |
| `src/jobs.ts` | HTML stripping + catalog formatting for the prompt. |
| `src/filters.ts` | Hard filter + the **relevance bar** (the tunable business rule). |
| `src/recommend.ts` | The cached, forced-tool-use Haiku call. |
| `src/usage.ts` | Token-usage / cache-hit logging. |
| `example/` | Sample data + runnable demo. |

## Things you'll likely tune

- **`CandidateProfile` shape** (`src/types.ts`) — align with your real profile object.
- **The relevance bar** (`clearsRelevanceBar` in `src/filters.ts`) — how strict to be.
- **Model** (`src/recommend.ts`) — bump to `claude-sonnet-4-6` if you want sharper
  reasoning on harder catalogs.
