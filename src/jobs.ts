import type { Job } from "./types.js";

/**
 * Strip HTML tags and decode the handful of entities that show up in JDs.
 * We do this before sending the catalog to the model: the tags are pure noise
 * that waste input tokens, and block-level tags become newlines so the JD
 * stays readable as plain text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*>/gi, "\n") // block ends -> newline
    .replace(/<\s*li[^>]*>/gi, "\n- ") // list items -> bullets
    .replace(/<[^>]+>/g, "") // drop remaining tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n") // collapse runs of blank lines
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatCompensation(job: Job): string {
  const c = job.compensation;
  if (!c || (c.min == null && c.max == null)) return "Not disclosed";
  const cur = c.currency ?? "USD";
  const period = c.period ?? "per year";
  const fmt = (n?: number) =>
    n == null ? "?" : new Intl.NumberFormat("en-US").format(n);
  const range =
    c.min != null && c.max != null
      ? `${fmt(c.min)}–${fmt(c.max)}`
      : fmt(c.min ?? c.max);
  return `${range} ${cur} ${period}`;
}

/**
 * Render one job as a compact, plain-text block for the prompt. The leading
 * `[id]` lets the model refer to jobs by id in its structured output without
 * us having to echo the full record back.
 */
export function formatJobForPrompt(job: Job): string {
  return [
    `[${job.id}] ${job.title} @ ${job.company}`,
    `Location: ${job.location} (${job.locationType}) · Type: ${job.employmentType}` +
      (job.department ? ` · Dept: ${job.department}` : ""),
    `Compensation: ${formatCompensation(job)}`,
    `Description:\n${stripHtml(job.description)}`,
  ].join("\n");
}

/** Render the whole catalog. This is the stable, cacheable chunk of the prompt. */
export function formatCatalog(jobs: Job[]): string {
  return jobs
    .map((j, i) => `### Job ${i + 1}\n${formatJobForPrompt(j)}`)
    .join("\n\n---\n\n");
}
