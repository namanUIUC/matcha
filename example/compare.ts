import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recommendJobs } from "../src/recommend.js";
import { fetchJobs } from "../src/jobBoard.js";
import { SAMPLE_CANDIDATES, type SampleCandidate } from "./sampleData.js";
import type { Job } from "../src/types.js";

// Runs the LLM rank-and-explain (recommend.ts) for EVERY sample candidate on
// the same live catalog, prints a summary, and writes one timestamped JSON +
// Markdown report covering all candidates for human review.

const TOP_N = 3;
const OUTPUT_DIR = "output";

interface CandidateReport {
  name: string;
  description: string;
  matches: { title: string; company: string; matchScore: number; reason: string; concern: string | null }[];
  noStrongMatch: boolean;
  filteredOutCount: number;
}

async function runOne(c: SampleCandidate, jobs: Job[]): Promise<CandidateReport> {
  const result = await recommendJobs({
    profile: c.profile,
    transcript: c.transcript,
    jobs,
    topN: TOP_N,
  });

  return {
    name: c.profile.name ?? "(unnamed)",
    description: c.description,
    matches: result.matches.map((m) => ({
      title: m.job.title,
      company: m.job.company,
      matchScore: m.matchScore,
      reason: m.reason,
      concern: m.concern ?? null,
    })),
    noStrongMatch: result.noStrongMatch,
    filteredOutCount: result.filteredOut.length,
  };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Set GEMINI_API_KEY first (see .env.example).");
    process.exit(1);
  }

  const jobs = await fetchJobs();
  console.log(`Fetched ${jobs.length} jobs. Running ${SAMPLE_CANDIDATES.length} candidates...\n`);

  // Sequential across candidates to stay under Gemini's free-tier rate limits.
  const reports: CandidateReport[] = [];
  for (const c of SAMPLE_CANDIDATES) {
    const r = await runOne(c, jobs);
    reports.push(r);
    console.log(`— ${r.name} —`);
    console.log(
      `  ${r.matches.map((m) => `${m.title} (${m.matchScore})`).join(", ") || "no strong match"}`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), jobsFetched: jobs.length, candidates: reports };
  const jsonPath = join(OUTPUT_DIR, `comparison-${stamp}.json`);
  const mdPath = join(OUTPUT_DIR, `comparison-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(mdPath, renderMarkdown(jobs.length, reports));

  console.log(`\nSaved for review:\n  ${jsonPath}\n  ${mdPath}`);
}

function renderMarkdown(jobsFetched: number, reports: CandidateReport[]): string {
  const out: string[] = [];
  out.push(`# Job recommendations — review`);
  out.push(`_Generated ${new Date().toISOString()} · ${jobsFetched} live jobs · ${reports.length} candidates_`);
  out.push(`\nFor each candidate: a brief profile, then the ranked job matches with reasons.\n`);

  for (const r of reports) {
    out.push(`---\n`);
    out.push(`## ${r.name}`);
    out.push(`> ${r.description}\n`);

    if (r.matches.length === 0) {
      out.push(`- _no strong match_`);
    } else {
      for (const m of r.matches) {
        out.push(`- **${m.matchScore}** — ${m.title} @ ${m.company}`);
        out.push(`  - ${m.reason}`);
        if (m.concern) out.push(`  - ⚠ ${m.concern}`);
      }
    }
    out.push(`\n_(${r.filteredOutCount} jobs hard-filtered out before the model)_\n`);
  }

  out.push(`---\n`);
  out.push(`## Human review`);
  out.push(`- [ ] For each candidate, are the ranked matches right?`);
  out.push(`- [ ] Any match that looks wrong on inspection?`);
  out.push(`- [ ] Did the hard filter wrongly drop anything?`);
  return out.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
