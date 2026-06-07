# Matcha — Phone-First Voice Career Agent 🍵

**Matcha** is a voice career-discovery agent you reach by **calling a phone number**.
You talk, Matcha interviews you, builds a structured career profile in real time,
then recommends **3 career paths** and **5 matching job openings** — all spoken
aloud over the call.

Built on the **Moss Hacker Starter** (LiveKit Agents + Moss + Next.js), this MVP
swaps the generic "docs helper" for a phone-first career interviewer.

## Sponsor stack

| Tech | Role in Matcha |
|------|----------------|
| **LiveKit** | Telephony (inbound calls) + voice agent orchestration |
| **MiniMax** | Text-to-speech voice (with an automatic Inference fallback) |
| **Moss** | Optional retrieval/memory layer (demo path works without it) |
| **LiveKit Inference** | LLM brain + STT — no extra provider keys required |

## What was built (hackathon MVP)

- 🎙️ **Matcha agent** (`agent-py/src/agent.py`) — phone-first career interviewer
  replacing the docs-helper. Asks discovery questions one at a time.
- 🧱 **Structured profile extraction** (`career_profile.py`) — an in-memory
  `CareerProfile` updated live via an `update_profile` tool. Resilient to partial
  data; tracks missing fields.
- 🧮 **Deterministic recommendation engine** (`recommendations.py`) — maps profile
  signals → top 3 roles with rationale + score.
- 💼 **Mock job matching** — 20 jobs in `jobs.json`, ranked by skill/interest/role/
  location overlap, returning the top 5 with human-readable reasons.
- 🔊 **TTS** (`tts_setup.py`) — reliable LiveKit Inference TTS by default; MiniMax
  is opt-in via `USE_MINIMAX_TTS=true` (needs a valid MiniMax JWT key).
- 🐛 **Debug surface** — every turn logs the profile to console and writes a
  per-call JSON snapshot to `agent-py/debug/<room>.json`; also published as data
  messages for an optional frontend panel.
- ✅ **Offline smoke test + unit tests** — verify the whole logic path with no
  credentials/network.

## Project layout

```txt
agent-py/
  src/
    agent.py            # Matcha LiveKit agent (entrypoint, tools, greeting)
    career_profile.py   # CareerProfile dataclass + extraction logic
    recommendations.py  # recommend_roles() + match_jobs() + spoken summary
    jobs.json           # 20 mock job postings
    tts_setup.py        # Inference TTS default; MiniMax opt-in
  scripts/
    smoke_test.py       # offline end-to-end logic demo (no creds)
  tests/test_agent.py   # deterministic unit tests
dispatch-rule.json      # LiveKit inbound dispatch rule → agent-py
inbound-trunk.json      # LiveKit inbound SIP trunk for +14849623113
frontend/               # Next.js app (optional browser debug surface)
.env.example
README.md
HACKATHON_PLAN.md
```

## Required environment variables

Copy `.env.example` → `.env` (project root) or `agent-py/.env.local`:

| Var | Required? | Purpose |
|-----|-----------|---------|
| `LIVEKIT_URL` | ✅ | LiveKit Cloud project URL (e.g. `wss://yc-hack-cqkbcxmo.livekit.cloud`) |
| `LIVEKIT_API_KEY` | ✅ | LiveKit API key |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit API secret |
| `USE_MINIMAX_TTS` | optional | `true` to use MiniMax voice (needs valid key) |
| `USE_FALLBACK_TTS` | optional | `true` to force the reliable Inference voice |
| `MINIMAX_API_KEY` | optional | MiniMax TTS (a long JWT `eyJ...`, not `sk-...`) |
| `MINIMAX_GROUP_ID` | optional | Required by some MiniMax accounts |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | optional | Moss retrieval/memory |

The agent **detects missing vars and logs clear warnings**. LiveKit vars are
required to connect; MiniMax/Moss degrade gracefully.

## Install & run the agent locally

```bash
cd agent-py
uv sync                                   # install deps (incl. MiniMax plugin)
uv run python src/agent.py download-files # one-time: VAD + turn-detector models
```

**Talk to Matcha in your terminal (fastest local test):**

```bash
uv run python src/agent.py console
```

**Run for phone/frontend (connects to LiveKit Cloud):**

```bash
uv run python src/agent.py dev
```

**Verify the logic with zero credentials:**

```bash
python3 scripts/smoke_test.py     # prints profile + roles + jobs + spoken text
```

## Deployment (local-connected vs Cloud)

The agent registers under `agent_name="agent-py"`
(`@server.rtc_session(agent_name="agent-py")` in `agent-py/src/agent.py`) and
connects to your LiveKit Cloud project from `LIVEKIT_URL`.

- **Local, connected to Cloud (fine for a live demo):**
  ```bash
  cd agent-py && uv run python src/agent.py dev
  ```
  Look for `registered worker {"agent_name": "agent-py", ...}` in the logs.
- **Production deploy (Docker):** the included `agent-py/Dockerfile` is ready.
  Deploy to LiveKit Cloud → https://docs.livekit.io/deploy/agents/

Either way, inbound calls are routed to this worker by the dispatch rule below.

## 📞 Phone Demo (connect a number → Matcha answers)

This is the headline feature. LiveKit routes an inbound PSTN call into a room
where **Matcha (dispatch name `agent-py`) answers** and runs the interview.

Reference docs:
- Phone numbers: https://docs.livekit.io/telephony/start/phone-numbers/
- Accepting calls: https://docs.livekit.io/telephony/accepting-calls/
- Dispatch rules: https://docs.livekit.io/telephony/accepting-calls/dispatch-rule/
- Deploy agents: https://docs.livekit.io/deploy/agents/

This repo includes two ready-to-edit config files:
- **`dispatch-rule.json`** — routes inbound calls to `agent-py` (room prefix `matcha-call-`).
- **`inbound-trunk.json`** — binds the rented number **`+14849623113`** to an inbound SIP trunk.

### Step 1 — Make sure the agent is running

```bash
cd agent-py && uv run python src/agent.py dev
```
Confirm the logs show it registered as `agent-py` against your Cloud project.

### Step 2 — Create an inbound trunk for the number

```bash
lk sip inbound create inbound-trunk.json
```
`inbound-trunk.json`:
```json
{ "trunk": { "name": "matcha-inbound-trunk", "numbers": ["+14849623113"] } }
```
Copy the returned **trunk id** — you'll paste it into `dispatch-rule.json` next.
(A LiveKit-managed number can do this for you from the dashboard instead.)

### Step 3 — Create the dispatch rule (targets `agent-py`)

**Option A — CLI (uses the included file):**
```bash
# paste your trunk id into dispatch-rule.json -> trunk_ids, then:
lk sip dispatch-rule create dispatch-rule.json
```
`dispatch-rule.json`:
```json
{
  "name": "matcha-inbound",
  "trunk_ids": ["<YOUR_INBOUND_TRUNK_ID>"],
  "rule": { "dispatchRuleIndividual": { "roomPrefix": "matcha-call-" } },
  "roomConfig": { "agents": [{ "agentName": "agent-py" }] }
}
```

**Option B — Dashboard:**
1. LiveKit Cloud dashboard → **Telephony → Dispatch Rules**.
2. **Create dispatch rule** → name it `matcha-inbound`.
3. Type **Individual** (new room per call), room prefix `matcha-call-`.
4. Set the dispatched **agent name** to **`agent-py`**.
5. **Save.** (Conceptually: `name: matcha-inbound`, `agentName: agent-py`,
   room pattern `matcha-call-*`.)

### Step 4 — Attach the number to the dispatch rule (dashboard)

1. LiveKit Cloud dashboard → **Telephony → Phone Numbers**.
2. Click the rented number **`+14849623113`**.
3. Set **Inbound dispatch rule** → **`matcha-inbound`**.
4. **Save.**

### Step 5 — Test checklist

- [ ] Agent is running and registered as `agent-py` in LiveKit Cloud.
- [ ] Dispatch rule `matcha-inbound` exists with `agentName: "agent-py"`.
- [ ] Phone number `+14849623113`'s inbound dispatch rule is set to `matcha-inbound`.
- [ ] TTS is working (Matcha speaks — verify in `console` mode first).
- [ ] Called `+14849623113` and heard Matcha answer and run the interview.

### What you should hear when you call `+14849623113`

1. **Greeting:** "Hi, I'm Matcha. I help people discover career paths that really
   fit who they are. To get started, can you tell me a little about yourself?"
2. **Interview:** one question at a time — experience → skills → interests →
   location/work prefs → role prefs → job postings → company/culture → level.
3. **Transition:** "Great, I have a good picture of you now. Based on what you've
   told me, here are some career paths that might be a good fit."
4. **Recommendations:** 3 career paths (with reasons) + 5 matching jobs.
5. **Close:** "Thanks for chatting with Matcha. Good luck with your career search."

> Tip: see `agent-py/debug/<room>.json` after a call for the captured profile,
> recommended roles, and matched jobs.

## Optional browser debug surface

The `frontend/` Next.js app can connect to the same agent in the browser for
testing without a phone. Matcha publishes `matcha_profile` and
`matcha_recommendations` data messages you can render. The phone path is the
priority; the browser is just a convenience.

```bash
cd frontend && pnpm install && pnpm dev
```

## What's real vs mocked

| Real | Mocked / simplified |
|------|---------------------|
| LiveKit voice pipeline (STT/LLM/TTS), telephony wiring | Job postings (`jobs.json`, 20 entries) |
| TTS (Inference default; MiniMax opt-in) | Recommendation rules (deterministic keyword map) |
| Live structured profile extraction via tool calls | No DB — profile is in-memory + JSON snapshot |
| Deterministic role + job ranking | No auth, no resume/cover-letter generation |

## Current limitations

- Jobs are static mock data; no live job-board API.
- Recommendation engine is rule-based keyword matching (explainable, not ML).
- Profile is per-call and in-memory (persisted only as a debug JSON file).
- Moss is wired as optional context but the demo path doesn't depend on it.
- No outbound calling; inbound only.

See **HACKATHON_PLAN.md** for cut features, stretch goals, and handoff notes.
