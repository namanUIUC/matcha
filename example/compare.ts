import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recommendJobs } from "../src/recommend.js";
import { semanticRecommendJobs } from "../src/semantic.js";
import { fetchJobs } from "../src/jobBoard.js";
import { SAMPLE_CANDIDATES, type SampleCandidate } from "./sampleData.js";
import type { Job } from "../src/types.js";

// Runs the LLM rank-and-explain (recommend.ts) and the embeddings-based
// semantic search (semantic.ts) for EVERY sample candidate on the same live
// catalog, prints a summary, and writes one timestamped JSON + Markdown report
// covering all candidates for human review.

const TOP_N = 3;
const OUTPUT_DIR = "output";

interface CandidateReport {
  name: string;
  description: string;
  llm: {
    matches: { title: string; company: string; matchScore: number; reason: string; concern: string | null }[];
    noStrongMatch: boolean;
  };
  semantic: {
    matches: { title: string; company: string; similarity: number }[];
  };
  filteredOutCount: number;
}

async function runOne(c: SampleCandidate, jobs: Job[]): Promise<CandidateReport> {
  const input = { profile: c.profile, transcript: c.transcript, jobs, topN: TOP_N };
  const [llm, semantic] = await Promise.all([
    recommendJobs(input),
    semanticRecommendJobs(input),
  ]);

  return {
    name: c.profile.name ?? "(unnamed)",
    description: c.description,
    llm: {
      matches: llm.matches.map((m) => ({
        title: m.job.title,
        company: m.job.company,
        matchScore: m.matchScore,
        reason: m.reason,
        concern: m.concern ?? null,
      })),
      noStrongMatch: llm.noStrongMatch,
    },
    semantic: {
      matches: semantic.matches.map((m) => ({
        title: m.job.title,
        company: m.job.company,
        similarity: m.similarity,
      })),
    },
    filteredOutCount: llm.filteredOut.length,
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
      `  LLM:      ${r.llm.matches.map((m) => `${m.title} (${m.matchScore})`).join(", ") || "no match"}`,
    );
    console.log(
      `  Semantic: ${r.semantic.matches.map((m) => `${m.title} (${m.similarity.toFixed(2)})`).join(", ") || "none"}`,
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
  out.push(`# Recommendation comparison — LLM vs semantic search`);
  out.push(`_Generated ${new Date().toISOString()} · ${jobsFetched} live jobs · ${reports.length} candidates_`);
  out.push(`\nFor each candidate: a brief profile, the LLM rank-and-explain output, and the`);
  out.push(`embeddings-based semantic ranking. Watch where they disagree.\n`);

  for (const r of reports) {
    out.push(`---\n`);
    out.push(`## ${r.name}`);
    out.push(`> ${r.description}\n`);

    out.push(`**LLM rank-and-explain**`);
    if (r.llm.matches.length === 0) {
      out.push(`- _no strong match_`);
    } else {
      for (const m of r.llm.matches) {
        out.push(`- **${m.matchScore}** — ${m.title} @ ${m.company}`);
        out.push(`  - ${m.reason}`);
        if (m.concern) out.push(`  - ⚠ ${m.concern}`);
      }
    }

    out.push(`\n**Semantic search (cosine similarity)**`);
    if (r.semantic.matches.length === 0) {
      out.push(`- _no candidates after filter_`);
    } else {
      for (const m of r.semantic.matches) {
        out.push(`- **${m.similarity.toFixed(4)}** — ${m.title} @ ${m.company}`);
      }
    }
    out.push(`\n_(${r.filteredOutCount} jobs hard-filtered out before either engine)_\n`);
  }

  out.push(`---\n`);
  out.push(`## Human review`);
  out.push(`- [ ] For each candidate, which engine ranked better?`);
  out.push(`- [ ] Where semantic and LLM disagree, which was right? (esp. Priya, Sara, Jordan)`);
  out.push(`- [ ] Any match that looks wrong on inspection?`);
  out.push(`- [ ] Did the hard filter wrongly drop anything?`);
  return out.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
