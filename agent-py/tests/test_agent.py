"""Deterministic unit tests for Matcha's core career logic.

These intentionally avoid LiveKit sessions / LLM judges so they run instantly
with no credentials — ideal for a hackathon. The agent's voice behavior is
driven by prompt instructions and verified live over a call.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from career_profile import CareerProfile  # noqa: E402
from recommendations import (  # noqa: E402
    format_recommendations_for_speech,
    match_jobs,
    recommend_roles,
)


def _sample_profile() -> CareerProfile:
    p = CareerProfile()
    p.update("name", "Jordan")
    p.update("skills", "javascript, apis, cloud, public speaking")
    p.update("interests", "technical, customer-facing, community")
    p.update("preferred_roles", "solutions engineer, developer advocate")
    return p


def test_profile_partial_extraction_and_dedup() -> None:
    p = CareerProfile()
    p.update("skills", "python, python, SQL")
    # De-duplicates case-insensitively and splits comma lists.
    assert p.skills == ["python", "SQL"]
    # Unknown fields are ignored, not crashing.
    p.update("not_a_field", "noise")
    assert "noise" not in p.skills


def test_missing_fields_tracking() -> None:
    p = CareerProfile()
    missing = p.recompute_missing()
    assert "skills" in missing and "name" in missing
    assert not p.has_enough_for_recommendations()


def test_has_enough_for_recommendations() -> None:
    p = _sample_profile()
    assert p.has_enough_for_recommendations()


def test_recommend_roles_is_deterministic_and_relevant() -> None:
    roles = recommend_roles(_sample_profile(), top_n=3)
    assert len(roles) == 3
    names = [r.role for r in roles]
    # Strong customer-facing + technical signal should surface Solutions Engineer.
    assert "Solutions Engineer" in names
    # Scores are sorted descending.
    assert roles[0].score >= roles[-1].score


def test_match_jobs_returns_top_five_with_reasons() -> None:
    profile = _sample_profile()
    roles = recommend_roles(profile, top_n=3)
    cats = [r.category for r in roles]
    jobs = match_jobs(profile, recommended_categories=cats, top_n=5)
    assert len(jobs) == 5
    # Every returned job has at least one human-readable reason.
    assert all(j.reasons for j in jobs)
    # Top job should be a strong, relevant match.
    assert jobs[0].score > 0


def test_spoken_summary_is_plain_text() -> None:
    profile = _sample_profile()
    roles = recommend_roles(profile, top_n=3)
    jobs = match_jobs(profile, recommended_categories=[r.category for r in roles])
    speech = format_recommendations_for_speech(roles, jobs)
    # No markdown / formatting characters that TTS would mangle.
    for ch in ["*", "#", "`", "|"]:
        assert ch not in speech
    assert "career paths" in speech.lower()


def test_recommendations_resilient_to_empty_profile() -> None:
    # Even with no data, the demo should never crash and always say something.
    empty = CareerProfile()
    roles = recommend_roles(empty, top_n=3)
    jobs = match_jobs(empty, recommended_categories=[r.category for r in roles])
    assert len(roles) == 3
    assert len(jobs) >= 1
