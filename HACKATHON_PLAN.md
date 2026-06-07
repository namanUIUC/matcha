# Matcha — Hackathon Plan

A phone-first voice career agent. Call a number → Matcha interviews you → builds a
structured profile → recommends 3 roles + 5 jobs, spoken aloud.

## ✅ Implemented features

- **Matcha career interviewer** (`agent-py/src/agent.py`) replacing the starter's
  docs-helper, with a phone-first system prompt (one question at a time, concise,
  no repetition, honest about uncertainty).
- **Structured profile** (`career_profile.py`): `CareerProfile` dataclass matching
  the spec, partial extraction, dedup, missing-field tracking, `has_enough_for_recommendations()`.
- **`update_profile` tool**: LLM extracts fields live during the call.
- **Recommendation engine** (`recommendations.py`): deterministic role mapping
  (Solutions Engineer, Developer Advocate, TAM, AI Consultant, CSE, Sales Engineer,
  + SWE/PM/Data/Designer) with rationale + score.
- **Job matching**: 20 mock jobs (`jobs.json`), weighted overlap on skills/interests/
  role-category/location → top 5 with reasons.
- **`deliver_recommendations` tool**: returns TTS-ready spoken summary.
- **MiniMax TTS** (`tts_setup.py`) with automatic Inference fallback.
- **Debug surface**: console profile logs + per-call JSON snapshot in `agent-py/debug/`
  + data messages (`matcha_profile`, `matcha_recommendations`).
- **Tests**: 7 deterministic unit tests + an offline `smoke_test.py` (no creds).
- **Docs**: README with full telephony/dispatch checklist; `.env.example`.

## ✂️ Intentionally cut

- Full browser voice UI (frontend kept only as optional debug surface).
- Auth, database, persistence beyond a per-call JSON file.
- Resume/cover-letter generation, application tracking.
- Live job-board API (mock jobs instead).
- ML-based recommendations (rule-based keyword matching instead).
- Outbound calling, multi-agent orchestration.

## 🌱 Stretch goals (if time remains)

- Use **Moss** to retrieve real job descriptions / ground matches in a corpus.
- Persist profiles across calls keyed by caller phone number (Moss memory index).
- Email/SMS the profile + recommendations after the call.
- Replace keyword rules with embedding similarity for role/job matching.
- Render the live `matcha_profile` / `matcha_recommendations` data messages in the
  Next.js frontend as a real-time debug dashboard.

## 🚀 Deployment notes

- Agent registers as `agent_name="agent-py"` — dispatch rules must target this name.
- Local: `uv run python src/agent.py console` (talk in terminal) or `dev` (connect).
- Telephony: deploy agent (Dockerfile included) → create inbound SIP trunk →
  create dispatch rule routing to `agent-py` → point number at trunk. See README
  "Connect a phone number" checklist with example `dispatch-rule.json`.
- Required env: `LIVEKIT_URL/API_KEY/API_SECRET`. Recommended: `MINIMAX_API_KEY`
  (+ `MINIMAX_GROUP_ID`). Optional: Moss keys.

## 🤝 Handoff notes for teammates

- **Core logic is decoupled from LiveKit.** `career_profile.py` and
  `recommendations.py` have zero LiveKit deps — run/iterate via
  `python3 scripts/smoke_test.py` without credentials or model downloads.
- **Add/edit jobs**: just edit `src/jobs.json` (keys: id, title, company, location,
  remoteType, skills, description, roleCategory, experienceLevel).
- **Tune recommendations**: edit `ROLE_RULES` in `recommendations.py` (signals +
  rationale) and the scoring weights in `match_jobs`.
- **Change the interview**: edit `MATCHA_INSTRUCTIONS` in `agent.py`.
- **Swap TTS voice/provider**: `tts_setup.py` is the single place to change it.
- **Known gotchas**: system Python lacks `pytest`; run tests via `uv run pytest`
  or the direct-call loop shown in the README. First `dev`/`console` run needs
  `uv run python src/agent.py download-files` for VAD + turn-detector models.

## Demo script (60 seconds)

1. Call the number. Matcha greets and asks you to introduce yourself.
2. Answer 4–6 questions (background, skills, interests, role/location prefs).
3. Matcha says "I have a good picture of you now" and reads 3 roles + 5 jobs.
4. Show `agent-py/debug/<room>.json` for the captured profile + matches.
