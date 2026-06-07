"""Live smoke test for the LLM job matcher (real Gemini call, no LiveKit).

Simulates a finished interview, then runs the same matcher + keyword-fallback
logic the agent uses in deliver_recommendations — against the real jobs.json and
a real Gemini call. Prints which engine produced the result.

Run:  uv run python scripts/llm_smoke.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

try:
    from dotenv import find_dotenv, load_dotenv

    load_dotenv(find_dotenv(".env.local", usecwd=True))
    load_dotenv(find_dotenv(".env", usecwd=True))
except ImportError:
    pass

from career_profile import CareerProfile
from llm_recommend import LlmMatchError, llm_match_jobs
from recommendations import match_jobs, recommend_roles


def build_profile() -> CareerProfile:
    p = CareerProfile()
    p.update("name", "Jordan")
    p.update("skills", "javascript, apis, cloud, public speaking")
    p.update("experience", "3 years at a SaaS startup running customer demos")
    p.update("interests", "technical, customer-facing, community, developer tools")
    p.update("preferred_roles", "solutions engineer, developer advocate")
    p.update("location_preferences", "remote")
    p.update("work_preferences", "remote, fast-paced startup")
    return p


TRANSCRIPT = [
    {"role": "agent", "text": "What kind of role are you looking for?"},
    {
        "role": "user",
        "text": "Something technical but customer-facing — solutions engineering or "
        "developer advocacy. I love running demos and being in front of developers.",
    },
    {"role": "agent", "text": "What's your background?"},
    {
        "role": "user",
        "text": "Three years at a SaaS startup doing demos and integrations. Strong with "
        "JavaScript, APIs, and cloud. I also speak at meetups.",
    },
]


def main() -> None:
    profile = build_profile()
    categories = [r.category for r in recommend_roles(profile, top_n=3)]

    print("Calling Gemini matcher against jobs.json...\n")
    engine = "llm"
    try:
        matches = llm_match_jobs(profile.to_dict(), transcript=TRANSCRIPT, top_n=5)
        if not matches:
            print(
                "LLM returned no jobs above the relevance bar — FALLING BACK to keyword.\n"
            )
            matches = match_jobs(profile, recommended_categories=categories, top_n=5)
            engine = "keyword_fallback"
    except LlmMatchError as e:
        print(f"LLM matcher unavailable ({e}) — FALLING BACK to keyword.\n")
        matches = match_jobs(profile, recommended_categories=categories, top_n=5)
        engine = "keyword_fallback"

    print(f"=== JOB MATCHES (engine: {engine}) ===")
    for m in matches:
        print(f"\n  [{m.score}] {m.job['title']} @ {m.job['company']}")
        for reason in m.reasons:
            print(f"      - {reason}")


if __name__ == "__main__":
    main()
