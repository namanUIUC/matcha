"""Deterministic career-role recommendation + mock-job matching.

Everything here is pure Python with no external calls so it runs instantly
during a phone call and is trivial to unit test. The Moss retrieval layer can
augment this later, but the demo path does not depend on it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from career_profile import CareerProfile

_JOBS_PATH = os.path.join(os.path.dirname(__file__), "jobs.json")


# ---------------------------------------------------------------------------
# Role recommendation
# ---------------------------------------------------------------------------

# Each role maps to a set of signal keywords. We score a role by how many of its
# signals appear anywhere in the profile (skills + interests + roles + prefs).
# This is intentionally simple and explainable — perfect for a hackathon demo.
ROLE_RULES: list[dict] = [
    {
        "role": "Solutions Engineer",
        "category": "solutions_engineer",
        "signals": ["technical", "customer-facing", "demos", "cloud", "apis", "presentations"],
        "rationale": "blends hands-on technical work with customer-facing demos",
    },
    {
        "role": "Developer Advocate",
        "category": "developer_advocate",
        "signals": ["speaking", "community", "technical", "content", "developer tools", "demos"],
        "rationale": "combines technical depth with speaking and community building",
    },
    {
        "role": "Technical Account Manager",
        "category": "technical_account_manager",
        "signals": ["saas", "onboarding", "implementation", "account management", "customer success"],
        "rationale": "focuses on SaaS onboarding, implementation, and long-term accounts",
    },
    {
        "role": "AI Consultant",
        "category": "ai_consultant",
        "signals": ["ai", "automation", "business process", "consulting", "machine learning", "python"],
        "rationale": "applies AI and automation to real business processes",
    },
    {
        "role": "Customer Success Engineer",
        "category": "customer_success_engineer",
        "signals": ["support", "product", "enterprise", "troubleshooting", "customer-facing", "apis"],
        "rationale": "supports enterprise clients with technical product expertise",
    },
    {
        "role": "Sales Engineer",
        "category": "sales_engineer",
        "signals": ["technical demos", "selling", "presentations", "customer-facing", "negotiation"],
        "rationale": "pairs technical demos with selling to close deals",
    },
    {
        "role": "Software Engineer",
        "category": "software_engineer",
        "signals": ["javascript", "python", "react", "backend", "frontend", "apis", "coding", "code"],
        "rationale": "centers on building software with code day-to-day",
    },
    {
        "role": "Data Analyst",
        "category": "data_analyst",
        "signals": ["sql", "data", "dashboards", "analytics", "excel"],
        "rationale": "turns data into dashboards and actionable insights",
    },
    {
        "role": "Product Manager",
        "category": "product_manager",
        "signals": ["product", "roadmap", "strategy", "communication", "leadership"],
        "rationale": "owns product direction across technical and business teams",
    },
    {
        "role": "UX Designer",
        "category": "designer",
        "signals": ["design", "creative", "figma", "user research", "prototyping"],
        "rationale": "shapes intuitive, creative user experiences",
    },
]


@dataclass
class RoleRecommendation:
    role: str
    category: str
    rationale: str
    score: int
    matched_signals: list[str]


def _profile_terms(profile: CareerProfile) -> list[str]:
    """Flatten the signal-bearing profile fields into lowercase terms."""
    terms: list[str] = []
    for field_name in [
        "skills",
        "interests",
        "preferred_roles",
        "work_preferences",
    ]:
        terms.extend(t.lower() for t in getattr(profile, field_name))
    return terms


def _matches(signal: str, terms: list[str]) -> bool:
    """A signal matches if it is a substring of (or contains) any profile term."""
    signal = signal.lower()
    return any(signal in term or term in signal for term in terms)


def recommend_roles(profile: CareerProfile, top_n: int = 3) -> list[RoleRecommendation]:
    """Return the top N roles for a profile, highest score first.

    Falls back to a sensible default set if nothing matches so the demo always
    has something to say.
    """
    terms = _profile_terms(profile)
    scored: list[RoleRecommendation] = []
    for rule in ROLE_RULES:
        matched = [s for s in rule["signals"] if _matches(s, terms)]
        if matched:
            scored.append(
                RoleRecommendation(
                    role=rule["role"],
                    category=rule["category"],
                    rationale=rule["rationale"],
                    score=len(matched),
                    matched_signals=matched,
                )
            )

    scored.sort(key=lambda r: r.score, reverse=True)

    if not scored:
        # Nothing matched — return a generic but useful starter set.
        return [
            RoleRecommendation(r["role"], r["category"], r["rationale"], 0, [])
            for r in ROLE_RULES[:top_n]
        ]
    return scored[:top_n]


# ---------------------------------------------------------------------------
# Job matching
# ---------------------------------------------------------------------------

_JOBS_CACHE: list[dict] | None = None


def load_jobs() -> list[dict]:
    global _JOBS_CACHE
    if _JOBS_CACHE is None:
        with open(_JOBS_PATH, encoding="utf-8") as f:
            _JOBS_CACHE = json.load(f)
    return _JOBS_CACHE


@dataclass
class JobMatch:
    job: dict
    score: int
    reasons: list[str]


def match_jobs(
    profile: CareerProfile,
    recommended_categories: list[str] | None = None,
    top_n: int = 5,
) -> list[JobMatch]:
    """Rank mock jobs by overlap with the profile.

    Scoring (simple, weighted, explainable):
      +2 for each skill overlap
      +1 for each interest overlap
      +3 if the job's roleCategory is in the recommended roles
      +1 for a location-preference hint match (remote/city)
    """
    recommended_categories = recommended_categories or []
    skill_terms = {s.lower() for s in profile.skills}
    interest_terms = {s.lower() for s in profile.interests}
    location_terms = {s.lower() for s in profile.location_preferences}
    work_terms = {s.lower() for s in profile.work_preferences}

    matches: list[JobMatch] = []
    for job in load_jobs():
        score = 0
        reasons: list[str] = []
        job_skills = {s.lower() for s in job.get("skills", [])}

        skill_overlap = _overlap(skill_terms, job_skills)
        if skill_overlap:
            score += 2 * len(skill_overlap)
            reasons.append("matches your skills in " + ", ".join(sorted(skill_overlap)))

        interest_overlap = _overlap(interest_terms, job_skills)
        if interest_overlap:
            score += len(interest_overlap)
            reasons.append("aligns with your interest in " + ", ".join(sorted(interest_overlap)))

        if job.get("roleCategory") in recommended_categories:
            score += 3
            reasons.append("fits a recommended career path")

        loc = (job.get("location", "") + " " + job.get("remoteType", "")).lower()
        loc_hits = {t for t in location_terms | work_terms if t and t in loc}
        if loc_hits:
            score += 1
            reasons.append("works for your location/work preference")

        if score > 0:
            matches.append(JobMatch(job=job, score=score, reasons=reasons))

    matches.sort(key=lambda m: m.score, reverse=True)

    if not matches:
        # Always return something for the demo: jobs in recommended categories,
        # or the first few jobs.
        fallback = [
            j for j in load_jobs() if j.get("roleCategory") in recommended_categories
        ] or load_jobs()
        return [
            JobMatch(job=j, score=0, reasons=["a solid general fit to explore"])
            for j in fallback[:top_n]
        ]
    return matches[:top_n]


def _overlap(profile_terms: set[str], job_terms: set[str]) -> set[str]:
    """Fuzzy-ish overlap using substring containment in both directions."""
    hits: set[str] = set()
    for p in profile_terms:
        for j in job_terms:
            if p and (p in j or j in p):
                hits.add(j)
    return hits


# ---------------------------------------------------------------------------
# Spoken-summary helpers
# ---------------------------------------------------------------------------

def format_recommendations_for_speech(
    roles: list[RoleRecommendation], jobs: list[JobMatch]
) -> str:
    """Build a concise, TTS-friendly plain-text summary (no markdown)."""
    lines: list[str] = []
    lines.append("Here are three career paths that fit you.")
    for i, r in enumerate(roles, 1):
        lines.append(f"{i}. {r.role}, because it {r.rationale}.")

    lines.append("And here are a few job openings that match.")
    for j in jobs:
        title = j.job.get("title")
        company = j.job.get("company")
        reason = j.reasons[0] if j.reasons else "looks like a good fit"
        lines.append(f"{title} at {company}, which {reason}.")
    return " ".join(lines)
