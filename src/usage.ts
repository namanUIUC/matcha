import type OpenAI from "openai";

/**
 * Print a token-usage breakdown. The key signal for caching is
 * `prompt_tokens_details.cached_tokens`: on a cold call it's 0, and on a later
 * call with the same prefix (catalog) it should jump to ~the catalog size,
 * billed at a discount. If it stays 0 across calls, the gateway/model isn't
 * reusing the prefix — a changed tool, a non-deterministic system block, or a
 * provider that doesn't support prompt caching.
 *
 * Note: Gemini reports `cached_tokens` from its implicit cache; it can
 * legitimately stay 0 if the prefix is below Gemini's minimum cacheable size.
 */
export function logUsage(usage: OpenAI.CompletionUsage, label = "usage"): void {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  console.log(
    `[${label}] prompt=${usage.prompt_tokens} ` +
      `cached=${cached} completion=${usage.completion_tokens}`,
  );
}
