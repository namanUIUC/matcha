import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recommendJobs } from "../src/recommend.js";
import { semanticRecommendJobs } from "../src/semantic.js";
import { fetchJobs } from "../src/jobBoard.js";
import { SAMPLE_PROFILE, SAMPLE_TRANSCRIPT } from "./sampleData.js";

// Runs the LLM rank-and-explain (recommend.ts) and the embeddings-based
// semantic search (semantic.ts) on the same candidate + catalog, prints both,
// and writes a timestamped JSON + Markdown pair to ./output for human review.

const TOP_N = 3;
const OUTPUT_DIR = "output";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Set GEMINI_API_KEY first (see .env.example).");
    process.exit(1);
  }

  const jobs = await fetchJobs();
  console.log(`Fetched ${jobs.length} jobs from the board.\n`);

  const input = {
    profile: SAMPLE_PROFILE,
    transcript: SAMPLE_TRANSCRIPT,
    jobs,
    topN: TOP_N,
  };

  // Run both engines. They share the hard filter, so the candidate pool matches.
  const [llm, semantic] = await Promise.all([
    recommendJobs(input),
    semanticRecommendJobs(input),
  ]);

  // --- Console summary ---
  console.log("=== LLM rank-and-explain (recommend.ts) ===");
  if (llm.matches.length === 0) console.log("  (no strong match)");
  for (const m of llm.matches) {
    console.log(`  ★ ${m.matchScore}  ${m.job.title} @ ${m.job.company}`);
    console.log(`     ${m.reason}`);
    if (m.concern) console.log(`     ⚠ ${m.concern}`);
  }

  console.log("\n=== Semantic search (semantic.ts) ===");
  if (semantic.matches.length === 0) console.log("  (no candidates after filter)");
  for (const m of semantic.matches) {
    console.log(
      `  ~ ${m.similarity.toFixed(4)}  ${m.job.title} @ ${m.job.company}`,
    );
  }

  // --- Persist for human review ---
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    candidate: SAMPLE_PROFILE.name ?? "(unnamed)",
    jobsFetched: jobs.length,
    llm: {
      matches: llm.matches.map((m) => ({
        jobId: m.job.id,
        title: m.job.title,
        company: m.job.company,
        matchScore: m.matchScore,
        reason: m.reason,
        concern: m.concern ?? null,
      })),
      noStrongMatch: llm.noStrongMatch,
      usage: llm.usage ?? null,
    },
    semantic: {
      matches: semantic.matches.map((m) => ({
        jobId: m.job.id,
        title: m.job.title,
        company: m.job.company,
        similarity: m.similarity,
      })),
    },
    filteredOut: llm.filteredOut,
  };

  const jsonPath = join(OUTPUT_DIR, `comparison-${stamp}.json`);
  const mdPath = join(OUTPUT_DIR, `comparison-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(mdPath, renderMarkdown(payload));

  console.log(`\nSaved for review:\n  ${jsonPath}\n  ${mdPath}`);
}

function renderMarkdown(p: ReturnType<typeof Object> & any): string {
  const lines: string[] = [];
  lines.push(`# Recommendation comparison — ${p.candidate}`);
  lines.push(`_Generated ${p.generatedAt} · ${p.jobsFetched} jobs fetched_\n`);

  lines.push(`## LLM rank-and-explain`);
  if (p.llm.matches.length === 0) lines.push(`_(no strong match)_`);
  for (const m of p.llm.matches) {
    lines.push(`- **${m.matchScore}** — ${m.title} @ ${m.company}`);
    lines.push(`  - ${m.reason}`);
    if (m.concern) lines.push(`  - ⚠ ${m.concern}`);
  }

  lines.push(`\n## Semantic search (cosine similarity)`);
  if (p.semantic.matches.length === 0) lines.push(`_(no candidates after filter)_`);
  for (const m of p.semantic.matches) {
    lines.push(`- **${m.similarity.toFixed(4)}** — ${m.title} @ ${m.company}`);
  }

  lines.push(`\n## Hard-filtered out (before either engine)`);
  for (const f of p.filteredOut) lines.push(`- ${f.jobId}: ${f.reason}`);

  lines.push(`\n## Human review`);
  lines.push(`- [ ] Which engine's ordering is better?`);
  lines.push(`- [ ] Did semantic search surface anything the LLM missed (or vice versa)?`);
  lines.push(`- [ ] Any match that looks wrong on inspection?`);
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
