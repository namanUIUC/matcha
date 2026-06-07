"""Offline smoke test for Matcha's core logic (no LiveKit / network needed).

Simulates a finished interview, builds a profile, and prints the recommended
roles + matched jobs exactly as Matcha would speak them.

Run:  uv run python scripts/smoke_test.py
  or: python scripts/smoke_test.py   (from agent-py/, no deps required)
"""

import os
import sys

# Make src/ importable when run directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from career_profile import CareerProfile  # noqa: E402
from recommendations import (  # noqa: E402
    format_recommendations_for_speech,
    match_jobs,
    recommend_roles,
)


def main() -> None:
    # Simulate what update_profile would have collected over a call.
    profile = CareerProfile()
    profile.update("name", "Jordan")
    profile.update("skills", "javascript, apis, cloud, public speaking")
    profile.update("experience", "3 years at a SaaS startup doing customer demos")
    profile.update("interests", "technical, customer-facing, community")
    profile.update("preferred_roles", "solutions engineer, developer advocate")
    profile.update("location_preferences", "remote")
    profile.update("work_preferences", "remote, fast-paced startup")

    print("=== PROFILE ===")
    print(profile.to_json())
    print("\nEnough for recommendations?", profile.has_enough_for_recommendations())

    roles = recommend_roles(profile, top_n=3)
    categories = [r.category for r in roles]
    jobs = match_jobs(profile, recommended_categories=categories, top_n=5)

    print("\n=== RECOMMENDED ROLES ===")
    for r in roles:
        print(f"- {r.role} (score {r.score}) — {r.rationale}")

    print("\n=== MATCHED JOBS ===")
    for j in jobs:
        print(f"- {j.job['title']} @ {j.job['company']} (score {j.score})")
        for reason in j.reasons:
            print(f"    · {reason}")

    print("\n=== SPOKEN SUMMARY (what Matcha says) ===")
    print(format_recommendations_for_speech(roles, jobs))


if __name__ == "__main__":
    main()
