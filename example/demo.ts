import { recommendJobs } from "../src/recommend.js";
import { fetchJobs } from "../src/jobBoard.js";
import { logUsage } from "../src/usage.js";
import { SAMPLE_PROFILE, SAMPLE_TRANSCRIPT } from "./sampleData.js";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Set GEMINI_API_KEY first (see .env.example).");
    process.exit(1);
  }

  const jobs = await fetchJobs();
  console.log(`Fetched ${jobs.length} jobs from the board.`);

  const result = await recommendJobs({
    profile: SAMPLE_PROFILE,
    transcript: SAMPLE_TRANSCRIPT,
    jobs,
    topN: 3,
  });

  console.log("\n=== Hard-filtered out (before LLM) ===");
  for (const f of result.filteredOut) {
    console.log(`  - ${f.jobId}: ${f.reason}`);
  }

  console.log("\n=== Top matches ===");
  if (result.matches.length === 0) {
    console.log("  (no strong match — nothing cleared the relevance bar)");
  }
  for (const m of result.matches) {
    console.log(`\n  ★ ${m.matchScore}  ${m.job.title} @ ${m.job.company}`);
    console.log(`     ${m.reason}`);
    if (m.concern) console.log(`     ⚠ ${m.concern}`);
  }

  console.log(`\nnoStrongMatch: ${result.noStrongMatch}`);
  console.log();
  if (result.usage) logUsage(result.usage);

  // Second call with the same catalog should read the catalog from cache —
  // watch cache_read jump from 0 to ~the catalog token count.
  const again = await recommendJobs({
    profile: SAMPLE_PROFILE,
    transcript: SAMPLE_TRANSCRIPT,
    jobs,
    topN: 3,
  });
  if (again.usage) logUsage(again.usage, "second call (expect cache_read > 0)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
