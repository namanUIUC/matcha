"""LLM rank-and-explain job matcher (Python port of the TypeScript engine).

This is a faithful port of the ``feat/reco`` matcher: a hard filter, a single
Gemini call that returns structured per-job ``matchScore`` / ``reason`` /
``concern`` via a forced tool-call, and a relevance bar applied to the result.
The pipeline and its constants are identical to the validated TS version — only
the job source differs (we read the local ``jobs.json`` instead of the Convex
board).

It is intentionally decoupled from LiveKit so it can be unit-tested with an
injected fake client (no network, no key). ``agent.py`` calls ``llm_match_jobs``
and falls back to the deterministic keyword matcher in ``recommendations.py`` if
this path errors, times out, or finds nothing.
"""

from __future__ import annotations

import json
import os
import re

from recommendations import JobMatch, load_jobs

# --- Config (env-overridable; mirrors feat/reco) ---------------------------
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_BASE_URL = os.getenv(
    "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"
)

# Relevance-bar knobs — ported verbatim from filters.ts so scoring behaves
# identically to the engine you reviewed.
MIN_MATCH_SCORE = 60  # absolute floor
RELATIVE_GAP = 15  # must be within this many points of the top match
CONCERN_PENALTY = 10  # a flagged concern raises the effective floor by this much

TOOL_NAME = "submit_recommendations"

# Same system instructions as recommend.ts. On the phone, the candidate's
# "resume" is the structured profile fields (experience, skills, interests),
# so the resume guideline still applies.
SYSTEM_INSTRUCTIONS = """You are a job-matching engine for a hiring product.

You are given a CANDIDATE PROFILE, the transcript of the candidate's intake
call, and a CATALOG of open jobs. Rank how well the candidate fits each job and
return the best matches.

Guidelines:
- Weigh the transcript heavily. It captures intent, soft preferences, and
  dealbreakers the structured profile may not — e.g. "I'd take less pay for
  remote" or "I'm burned out on early-stage startups".
- Weigh the candidate's experience just as heavily: their skills, the work
  they've actually done, and the roles they're targeting. A genuine fit needs
  demonstrated experience to back it up, not just stated interest — match what
  they've done against what the job needs.
- The job requirements live inside each Description; read them.
- Score each job 0-100 for genuine fit (skills, seniority, location/remote,
  and what the candidate actually said they want).
- Be honest and selective. This protects hiring managers from irrelevant
  candidates: if nothing is a strong fit, say so by returning few or no matches
  rather than padding the list. Do NOT recommend a job you scored below 60.
- Each reason must be one or two sentences, candidate-facing, and cite something
  concrete from their profile or the call.
- Refer to jobs by the [id] shown in brackets."""

RECOMMENDATION_TOOL = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Submit the ranked job matches for this candidate. Return at most the "
            "requested number, ordered best-first. Omit any job that is not a "
            "genuine fit."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "recommendations": {
                    "type": "array",
                    "description": "Best matches, best first. May be empty if nothing fits well.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "jobId": {
                                "type": "string",
                                "description": "The [id] of the job.",
                            },
                            "matchScore": {
                                "type": "integer",
                                "description": "0-100 genuine-fit score for this candidate.",
                            },
                            "reason": {
                                "type": "string",
                                "description": (
                                    "1-2 sentences, candidate-facing, citing something concrete "
                                    "from the profile or call."
                                ),
                            },
                            "concern": {
                                "type": "string",
                                "description": (
                                    "Optional caveat the recruiter/candidate should know "
                                    "(e.g. salary below ask)."
                                ),
                            },
                        },
                        "required": ["jobId", "matchScore", "reason"],
                    },
                },
                "noStrongMatch": {
                    "type": "boolean",
                    "description": "True if no job is a strong fit for this candidate.",
                },
            },
            "required": ["recommendations", "noStrongMatch"],
        },
    },
}


class LlmMatchError(Exception):
    """Raised when the LLM matcher cannot produce a usable result.

    The caller catches this to fall back to the deterministic keyword matcher.
    """


# ---------------------------------------------------------------------------
# Hard filter + relevance bar (ports of filters.ts)
# ---------------------------------------------------------------------------

_REMOTE_TYPE_TO_LOCATION = {"in-person": "onsite"}


def _hard_filter_reason(job: dict, dealbreakers: dict) -> str | None:
    """Drop jobs the candidate explicitly ruled out. Returns the reason or None.

    jobs.json has no status/employmentType/compensation fields, and the phone
    profile carries no structured dealbreakers, so in practice this drops
    nothing today — but the logic is the exact port, ready for richer data.
    """
    if job.get("status", "live") != "live":
        return "job is not live"

    remote_type = job.get("remoteType")
    location_type = _REMOTE_TYPE_TO_LOCATION.get(remote_type, remote_type)

    if dealbreakers.get("remoteOnly") and location_type != "remote":
        return f"candidate is remote-only; job is {location_type}"

    if dealbreakers.get("fullTimeOnly"):
        employment = job.get("employmentType")
        if employment and employment != "full_time":
            return f"candidate wants full-time; job is {employment}"

    min_salary = dealbreakers.get("minSalary")
    if min_salary is not None:
        comp_max = (job.get("compensation") or {}).get("max")
        if comp_max is not None and comp_max < min_salary:
            return f"job max {comp_max} is below candidate floor {min_salary}"

    return None


def _clears_relevance_bar(score: int, has_concern: bool, best_in_batch: int) -> bool:
    """Port of clearsRelevanceBar: absolute floor + relative gap + concern penalty."""
    effective_floor = MIN_MATCH_SCORE + (CONCERN_PENALTY if has_concern else 0)
    return score >= effective_floor and score >= best_in_batch - RELATIVE_GAP


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    """jobs.json descriptions are already plain text; this is a harmless guard."""
    return _TAG_RE.sub("", text or "").strip()


def _format_job_for_prompt(job: dict) -> str:
    meta = f"Location: {job.get('location', '')} ({job.get('remoteType', '')})"
    if job.get("roleCategory"):
        meta += f" · {job['roleCategory']}"
    if job.get("experienceLevel"):
        meta += f" · {job['experienceLevel']}"
    return "\n".join(
        [
            f"[{job.get('id', '')}] {job.get('title', '')} @ {job.get('company', '')}",
            meta,
            f"Description:\n{_strip_html(job.get('description', ''))}",
        ]
    )


def _format_catalog(jobs: list[dict]) -> str:
    blocks = [
        f"### Job {i + 1}\n{_format_job_for_prompt(j)}" for i, j in enumerate(jobs)
    ]
    return "\n\n---\n\n".join(blocks)


def _build_user_content(profile: dict, transcript: list[dict], top_n: int) -> str:
    lines = ["CANDIDATE PROFILE (JSON):", json.dumps(profile, indent=2), ""]
    if transcript:
        rendered = "\n".join(
            f"{'Interviewer' if t.get('role') == 'agent' else 'Candidate'}: {t.get('text', '')}"
            for t in transcript
        )
        lines += ["INTAKE CALL TRANSCRIPT:", rendered, ""]
    else:
        lines += ["INTAKE CALL TRANSCRIPT: (unavailable)", ""]
    lines.append(
        f"Return your top {top_n} job matches (fewer if fewer are a genuine fit), best first."
    )
    return "\n".join(lines)


def _default_client():
    """Construct a Gemini client via the OpenAI-compatible SDK. Raises if unusable."""
    try:
        from openai import OpenAI
    except ImportError as e:  # pragma: no cover - exercised only without the dep
        raise LlmMatchError("openai package not installed") from e
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise LlmMatchError("GEMINI_API_KEY not set")
    return OpenAI(api_key=api_key, base_url=GEMINI_BASE_URL)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def llm_match_jobs(
    profile: dict,
    transcript: list[dict] | None = None,
    jobs: list[dict] | None = None,
    top_n: int = 5,
    client=None,
    model: str | None = None,
    timeout: float = 8.0,
) -> list[JobMatch]:
    """Rank jobs for a candidate with the LLM, returning a drop-in ``JobMatch`` list.

    ``profile`` is the CareerProfile as a dict. ``transcript`` is a list of
    ``{"role": "agent"|"user", "text": str}`` turns. Raises ``LlmMatchError`` on
    any failure so the caller can fall back to the keyword matcher.
    """
    jobs = jobs if jobs is not None else load_jobs()
    transcript = transcript or []

    # 1. Hard filter (no structured dealbreakers on the phone profile -> no-op today).
    candidates = [j for j in jobs if _hard_filter_reason(j, {}) is None]
    if not candidates:
        return []

    # 2. Single forced-tool-call to Gemini.
    if client is None:
        client = _default_client()
    model = model or DEFAULT_MODEL
    system = (
        f"{SYSTEM_INSTRUCTIONS}\n\n"
        f"JOB CATALOG ({len(candidates)} live jobs):\n\n{_format_catalog(candidates)}"
    )
    user = _build_user_content(profile, transcript, top_n)

    try:
        response = client.chat.completions.create(
            model=model,
            max_tokens=4096,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            tools=[RECOMMENDATION_TOOL],
            tool_choice={"type": "function", "function": {"name": TOOL_NAME}},
            timeout=timeout,
        )
    except Exception as e:
        raise LlmMatchError(f"Gemini call failed: {e}") from e

    # 3. Parse the forced tool call.
    choices = getattr(response, "choices", None) or []
    message = choices[0].message if choices else None
    tool_calls = getattr(message, "tool_calls", None) if message else None
    if not tool_calls:
        raise LlmMatchError("model did not return a tool call")
    try:
        result = json.loads(tool_calls[0].function.arguments)
    except (json.JSONDecodeError, AttributeError, TypeError) as e:
        raise LlmMatchError(f"could not parse tool call arguments: {e}") from e

    # 4. Map ids back to jobs, drop hallucinated ids, sort, apply the relevance bar.
    by_id = {j.get("id"): j for j in candidates}
    scored: list[tuple[dict, int, str, str | None]] = []
    for rec in result.get("recommendations") or []:
        job = by_id.get(rec.get("jobId"))
        if job is None:
            continue
        scored.append(
            (
                job,
                int(rec.get("matchScore", 0)),
                rec.get("reason", ""),
                rec.get("concern"),
            )
        )
    scored.sort(key=lambda t: t[1], reverse=True)

    best = scored[0][1] if scored else 0
    matches: list[JobMatch] = []
    for job, score, reason, concern in scored:
        if not _clears_relevance_bar(score, bool(concern), best):
            continue
        reasons = [reason] if reason else []
        if concern:
            reasons.append(f"Note: {concern}")
        matches.append(JobMatch(job=job, score=score, reasons=reasons))
        if len(matches) >= top_n:
            break
    return matches
