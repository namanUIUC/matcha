"""Deterministic unit tests for the LLM job matcher (llm_recommend.py).

These inject a fake OpenAI-compatible client so the full pipeline — hard filter,
forced-tool-call parsing, and the relevance bar — is exercised with no network,
no key, and no LiveKit session. Mirrors the no-creds style of test_agent.py.
"""

import json
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from llm_recommend import (
    LlmMatchError,
    _hard_filter_reason,
    llm_match_jobs,
)
from recommendations import load_jobs


def _stub_client(
    recommendations,
    *,
    no_strong_match=False,
    raise_exc=None,
    no_tool_call=False,
):
    """Build a fake client whose .chat.completions.create mimics the SDK shape."""

    def create(**_kwargs):
        if raise_exc is not None:
            raise raise_exc
        if no_tool_call:
            message = SimpleNamespace(tool_calls=None)
        else:
            args = json.dumps(
                {"recommendations": recommendations, "noStrongMatch": no_strong_match}
            )
            fn = SimpleNamespace(name="submit_recommendations", arguments=args)
            message = SimpleNamespace(
                tool_calls=[SimpleNamespace(type="function", function=fn)]
            )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)

    completions = SimpleNamespace(create=create)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions))


def _ids() -> list[str]:
    return [j["id"] for j in load_jobs()]


def test_hard_filter_keeps_all_jobs_without_dealbreakers() -> None:
    # The phone profile has no structured dealbreakers, so nothing is dropped.
    jobs = load_jobs()
    kept = [j for j in jobs if _hard_filter_reason(j, {}) is None]
    assert len(kept) == len(jobs) > 0


def test_ranks_and_applies_relevance_bar() -> None:
    ids = _ids()
    recs = [
        {"jobId": ids[0], "matchScore": 95, "reason": "great fit"},
        {"jobId": ids[1], "matchScore": 88, "reason": "good fit"},
        {"jobId": ids[2], "matchScore": 50, "reason": "weak"},  # < floor 60 -> dropped
        {"jobId": ids[3], "matchScore": 70, "reason": "far"},  # < 95-15 gap -> dropped
    ]
    matches = llm_match_jobs({"name": "x"}, jobs=load_jobs(), client=_stub_client(recs))
    assert [(m.job["id"], m.score) for m in matches] == [(ids[0], 95), (ids[1], 88)]
    assert all(m.reasons for m in matches)


def test_concern_raises_effective_floor() -> None:
    ids = _ids()
    # 65 would clear the base floor (60) but a concern lifts it to 70 -> dropped.
    recs = [
        {"jobId": ids[0], "matchScore": 65, "reason": "ok", "concern": "salary low"}
    ]
    matches = llm_match_jobs({}, jobs=load_jobs(), client=_stub_client(recs))
    assert matches == []


def test_concern_is_annotated_when_match_clears() -> None:
    ids = _ids()
    recs = [
        {"jobId": ids[0], "matchScore": 80, "reason": "strong", "concern": "location"}
    ]
    matches = llm_match_jobs({}, jobs=load_jobs(), client=_stub_client(recs))
    assert len(matches) == 1
    assert any("Note:" in r for r in matches[0].reasons)


def test_hallucinated_job_id_is_dropped() -> None:
    recs = [{"jobId": "not-a-real-id", "matchScore": 99, "reason": "x"}]
    matches = llm_match_jobs({}, jobs=load_jobs(), client=_stub_client(recs))
    assert matches == []


def test_empty_recommendations_returns_empty() -> None:
    matches = llm_match_jobs(
        {}, jobs=load_jobs(), client=_stub_client([], no_strong_match=True)
    )
    assert matches == []


def test_client_error_raises_llmmatcherror() -> None:
    client = _stub_client([], raise_exc=RuntimeError("429 rate limit"))
    with pytest.raises(LlmMatchError):
        llm_match_jobs({}, jobs=load_jobs(), client=client)


def test_missing_tool_call_raises_llmmatcherror() -> None:
    with pytest.raises(LlmMatchError):
        llm_match_jobs({}, jobs=load_jobs(), client=_stub_client([], no_tool_call=True))


def test_top_n_caps_results() -> None:
    ids = _ids()
    # Five strong, tightly-clustered matches; top_n=2 should trim to 2.
    recs = [
        {"jobId": ids[i], "matchScore": 95 - i, "reason": f"fit {i}"} for i in range(5)
    ]
    matches = llm_match_jobs({}, jobs=load_jobs(), client=_stub_client(recs), top_n=2)
    assert len(matches) == 2
    assert [m.job["id"] for m in matches] == [ids[0], ids[1]]
