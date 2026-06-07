"""In-memory structured career profile for the Matcha phone agent.

The profile is built progressively during a phone call as the LLM calls the
`update_profile` tool. Everything here is plain-Python and dependency-free so it
is easy to unit test and easy to continue after the hackathon.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

# Fields the interview tries to fill. `name` and `summary` are scalar strings;
# everything else is a list we append to as the conversation progresses.
LIST_FIELDS = [
    "skills",
    "experience",
    "education",
    "interests",
    "preferred_roles",
    "location_preferences",
    "work_preferences",
]

# The minimum set of fields we want before moving to recommendations. We don't
# require ALL fields — phone calls are short and people get bored. Skills +
# interests + preferred roles is enough for a useful, deterministic match.
CORE_FIELDS_FOR_RECOMMENDATIONS = ["skills", "interests", "preferred_roles"]


@dataclass
class CareerProfile:
    """Mirror of the CareerProfile TypeScript type from the spec.

    Kept resilient to partial data: every field has a safe default so the
    recommendation engine never crashes on an incomplete profile.
    """

    name: str = ""
    skills: list[str] = field(default_factory=list)
    experience: list[str] = field(default_factory=list)
    education: list[str] = field(default_factory=list)
    interests: list[str] = field(default_factory=list)
    preferred_roles: list[str] = field(default_factory=list)
    location_preferences: list[str] = field(default_factory=list)
    work_preferences: list[str] = field(default_factory=list)
    summary: str = ""
    missing_fields: list[str] = field(default_factory=list)

    def update(self, field_name: str, value) -> None:
        """Apply a partial extraction for a single field.

        - Scalar fields (`name`, `summary`) are overwritten.
        - List fields are extended with de-duplicated, trimmed values.
        Unknown field names are ignored so a hallucinated tool arg can't crash
        the call.
        """
        if field_name in ("name", "summary"):
            text = _as_text(value)
            if text:
                setattr(self, field_name, text)
            return

        if field_name in LIST_FIELDS:
            current = getattr(self, field_name)
            for item in _as_list(value):
                cleaned = item.strip()
                if cleaned and cleaned.lower() not in {c.lower() for c in current}:
                    current.append(cleaned)

    def recompute_missing(self) -> list[str]:
        """Refresh and return the list of still-empty core fields."""
        missing = []
        if not self.name:
            missing.append("name")
        for f in LIST_FIELDS:
            if not getattr(self, f):
                missing.append(f)
        self.missing_fields = missing
        return missing

    def has_enough_for_recommendations(self) -> bool:
        """True once the core fields needed for a useful match are present."""
        return all(getattr(self, f) for f in CORE_FIELDS_FOR_RECOMMENDATIONS)

    def to_dict(self) -> dict:
        self.recompute_missing()
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


def _as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip()


def _as_list(value) -> list[str]:
    """Coerce a tool argument into a clean list of strings.

    Accepts a list, a single string, or a comma/semicolon-separated string so
    the LLM can be a little sloppy without breaking extraction.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    text = str(value)
    for sep in [";", ",", " and "]:
        if sep in text:
            return [part for part in (p.strip() for p in text.split(sep)) if part]
    return [text] if text.strip() else []
