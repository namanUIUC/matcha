# Matcha — Phone-First Voice Career Agent 🍵

**Matcha** is a voice career-discovery agent you reach by **calling a phone number**.
You talk, Matcha interviews you, builds a structured career profile in real time,
remembers you across calls, and matches you against open roles in the background.
At the end of the call it doesn't read jobs aloud — it tells you to **log in at
matcha.com with your phone number** to see your matches on a dashboard.

Built on the **Moss Hacker Starter** (LiveKit Agents + Moss + Next.js), this MVP
turns the generic "docs helper" into a phone-first career interviewer backed by a
real Convex database, per-caller memory, and a résumé-enrichment pipeline.

## How it works (data flow)

```txt
   ☎️  Caller dials +1 484 962 3113
        │
        ▼
 ┌──────────────────────────┐    sip.phoneNumber → user_id
 │  LiveKit SIP + Agents     │───────────────────────────────┐
 │  Matcha (agent-py)        │                               │
 │  • STT/LLM/TTS pipeline    │     recall prior facts        ▼
 │  • interview + tools       │◀───────────────────────  ┌─────────┐
 │  • update_profile          │     index new facts       │  Moss   │  per-phone
 │  • remember/recall_facts   │──────────────────────────▶│ memory  │  memory index
 └──────────────────────────┘                            └─────────┘
        │  on end_call / shutdown
        │  POST profile + ask for matches
        ▼
 ┌──────────────────────────┐    /api/career-profile     ┌──────────────────────┐
 │  Convex backend (ui/)     │◀───────────────────────────│  career profile JSON │
 │  • careerProfiles table    │    /api/recommend-jobs     └──────────────────────┘
 │  • jobs (seeded demo)      │
 │  • jobRecommendations      │
 │  • résumé enrich (Unsiloed)│
 │  • phone-OTP auth (Twilio) │
 └──────────────────────────┘
        ▲
        │  log in with phone number
   🖥️  Candidate dashboard (Next.js) → sees matches, uploads résumé
```

## Sponsor / tech stack

| Tech | Role in Matcha |
|------|----------------|
| **LiveKit** | Telephony (inbound calls) + voice agent orchestration |
| **LiveKit Inference** | LLM brain (`openai/gpt-5.2-chat-latest`) + STT (`deepgram/nova-3`) — no extra provider keys |
| **MiniMax** | Text-to-speech voice (with an automatic Inference fallback) |
| **Moss** | Per-caller memory index — remembers facts across calls, keyed by phone number |
| **Convex** | Backend DB + HTTP endpoints (profiles, jobs, recommendations) and phone-OTP auth |
| **Unsiloed** | Résumé parsing/extraction to enrich a profile from an uploaded CV |
| **Twilio** | Delivers the SMS one-time code for dashboard login (optional in dev) |
| **Next.js** | Candidate dashboard (`ui/`) + an optional browser debug surface (`frontend/`) |

## What's in the repo

- 🎙️ **Matcha agent** (`agent-py/src/agent.py`) — phone-first career interviewer.
  Introduces itself, asks for the caller's name, then works through a fixed
  interview flow one question at a time. Personalizes the opening for **returning
  callers** using facts recalled from Moss.
- 🧱 **Structured profile** (`agent-py/src/career_profile.py`) — an in-memory
  `CareerProfile` updated live via the `update_profile` tool. Resilient to partial
  data; tracks missing fields. Mirrors the Convex `careerProfiles` schema.
- 🧠 **Per-caller memory** — `remember_fact` / `recall_facts` tools plus automatic
  indexing of every recorded field into a Moss **memory** index, scoped by
  `user_id` (the caller's E.164 phone number). Future calls recall it.
- 🔚 **`end_call` tool** — speaks one closing line, fires the Convex hand-off in
  the background, and tears the room down. A shutdown callback is a safety net for
  early hangups.
- 🗄️ **Convex backend** (`ui/convex/careerProfiles/`) — HTTP endpoints
  `POST /api/career-profile` (upsert profile) and `POST /api/recommend-jobs`
  (score + persist matches). Tables: `careerProfiles`, `jobs` (seeded from
  `demoJobs.ts`), `jobRecommendations`.
- 📄 **Résumé enrichment** (`ui/convex/careerProfiles/enrich.ts`) — extracts
  structured fields from an uploaded résumé via the **Unsiloed** Vision API and
  merges them into the profile.
- 🔐 **Candidate dashboard** (`ui/`) — Next.js + Convex Auth phone-OTP login. Log
  in with your phone number to review your profile, upload a résumé, and see
  matched jobs.
- 🔊 **TTS** (`agent-py/src/tts_setup.py`) — MiniMax voice by default with an
  automatic LiveKit Inference fallback.
- 🐛 **Debug surface** — per-turn profile logs + a per-call JSON snapshot in
  `agent-py/debug/<room>.json`, plus `matcha_profile` data messages for the
  optional browser frontend.
- ✅ **Unit tests** (`agent-py/tests/`) — deterministic, no credentials/network.

## Project layout

```txt
agent-py/                       # Python voice agent (uv-managed)
  src/
    agent.py                    # Matcha LiveKit agent: entrypoint, tools, Moss memory, Convex hand-off
    career_profile.py           # CareerProfile dataclass + extraction logic
    recommendations.py          # local rule-based matcher (kept for fallback; not wired into the live call)
    create_index.py             # builds the Moss memory/knowledge indexes
    jobs.json                   # demo job postings (also mirrored into Convex)
    tts_setup.py                # MiniMax TTS with Inference fallback
  tests/                        # deterministic unit tests
  Dockerfile                    # production deploy to LiveKit Cloud

ui/                             # Candidate dashboard — Next.js 16 + Convex (THE product UI)
  convex/
    schema.ts                   # careerProfiles, jobs, jobRecommendations, auth tables
    http.ts                     # mounts the careerProfiles HTTP routes
    auth.ts / auth.config.ts    # Convex Auth (phone OTP)
    careerProfiles/
      endpoints.ts              # /api/career-profile + /api/recommend-jobs (httpAction)
      create.ts read.ts me.ts   # profile upsert / read
      enrich.ts                 # résumé extraction via Unsiloed
      recommendJobs.ts jobs.ts  # scoring + job queries
      demoJobs.ts               # seed jobs on first run
  src/                          # dashboard pages, ResumeUpload, lib/unsiloed.ts
  .env.example

frontend/                       # OPTIONAL browser debug surface (LiveKit React starter)
dispatch-rule.json              # LiveKit inbound dispatch rule → agent-py
inbound-trunk.json              # LiveKit inbound SIP trunk for +14849623113
README.md
HACKATHON_PLAN.md
```

> **Two frontends, on purpose:** `ui/` is the real product (dashboard + Convex
> backend the agent talks to). `frontend/` is just a browser way to talk to the
> voice agent without a phone — a convenience for testing.

## Environment variables

There is no longer a root `.env.example`; each app has its own config.

### Agent — `agent-py/.env.local` (or a `.env` found by walking up the tree)

| Var | Required? | Purpose |
|-----|-----------|---------|
| `LIVEKIT_URL` | ✅ | LiveKit Cloud project URL (e.g. `wss://<project>.livekit.cloud`) |
| `LIVEKIT_API_KEY` | ✅ | LiveKit API key |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit API secret |
| `MINIMAX_API_KEY` | optional | MiniMax TTS (a long JWT `eyJ...`); falls back to Inference TTS if unset |
| `MINIMAX_GROUP_ID` | optional | Required by some MiniMax accounts |
| `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` | optional | Enables per-caller memory; tools no-op if unset |
| `MOSS_MEMORY_INDEX_NAME` | optional | Memory index name (default `memory`) |
| `CONVEX_SITE_URL` | optional | Convex `*.convex.site` origin; enables the profile/recommendation hand-off |
| `MATCHA_INGEST_SECRET` | optional | Shared secret sent as `x-matcha-secret` to the Convex endpoints |
| `MATCHA_DEBUG_DIR` | optional | Where per-call JSON snapshots are written (default `debug`) |

The agent **detects missing vars and logs clear warnings**. Only the LiveKit vars
are required to connect; Moss, MiniMax and Convex degrade gracefully (the
interview still runs, it just won't remember you or fill the dashboard).

### Dashboard — `ui/.env.example`

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL (browser client) |
| `CONVEX_SITE_URL` | Convex HTTP origin (must match what the agent posts to) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_PHONE` | SMS one-time-code delivery (optional in dev — code is logged to console) |
| `UNSILOED_API_KEY` | Résumé extraction (https://docs.unsiloed.ai) |

## Run the agent locally

```bash
cd agent-py
uv sync                                   # install deps
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

**Run the tests:**

```bash
uv run pytest
```

> Moss memory keys off the caller's phone number. In `console` mode there is no
> real number, so the agent uses a fallback id (`matcha-local`) — repeat console
> sessions still exercise the returning-caller path.

## Run the dashboard locally

```bash
cd ui
pnpm install
npx convex dev          # starts the Convex backend (prints NEXT_PUBLIC_CONVEX_URL / CONVEX_SITE_URL)
pnpm dev                # Next.js dashboard
```

Set `CONVEX_SITE_URL` (+ `MATCHA_INGEST_SECRET`) in `agent-py/.env.local` to the
Convex HTTP origin so the agent's hand-off lands in the same deployment you're
viewing.

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

Inbound calls are routed to this worker by the dispatch rule below.

## 📞 Phone demo (connect a number → Matcha answers)

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
Copy the returned **trunk id** — you'll paste it into `dispatch-rule.json` next.
(A LiveKit-managed number can do this for you from the dashboard instead.)

### Step 3 — Create the dispatch rule (targets `agent-py`)

```bash
# paste your trunk id into dispatch-rule.json -> trunk_ids, then:
lk sip dispatch-rule create dispatch-rule.json
```
```json
{
  "name": "matcha-inbound",
  "trunk_ids": ["<YOUR_INBOUND_TRUNK_ID>"],
  "rule": { "dispatchRuleIndividual": { "roomPrefix": "matcha-call-" } },
  "roomConfig": { "agents": [{ "agentName": "agent-py" }] }
}
```
(Or do it from the dashboard: **Telephony → Dispatch Rules → Create**, type
**Individual**, room prefix `matcha-call-`, dispatched agent name **`agent-py`**.)

### Step 4 — Attach the number to the dispatch rule (dashboard)

**Telephony → Phone Numbers** → click **`+14849623113`** → set **Inbound dispatch
rule** → **`matcha-inbound`** → **Save**.

### Step 5 — Test checklist

- [ ] Agent is running and registered as `agent-py` in LiveKit Cloud.
- [ ] Dispatch rule `matcha-inbound` exists with `agentName: "agent-py"`.
- [ ] Phone number `+14849623113`'s inbound dispatch rule is set to `matcha-inbound`.
- [ ] TTS is working (verify in `console` mode first).
- [ ] (Optional) `CONVEX_SITE_URL` set so matches land on the dashboard.
- [ ] Called `+14849623113` and heard Matcha answer and run the interview.

### What you should hear when you call `+14849623113`

1. **Opening:** "Hi, I'm Matcha, and I'm gonna match you to a job. No honestly, I
   help people find their next role. Who am I talking with?" (returning callers get
   a recognized greeting drawn from Moss memory).
2. **Name → intro:** after you give your name, "Nice to talk to you. Tell me a
   little about yourself."
3. **Interview:** one question at a time — experience → skills → interests →
   location/work prefs → education → job postings → company/culture → level & pay.
4. **Close:** Matcha says it has what it needs, will match you in the background,
   and to **log in at matcha dot com with your phone number** to see your matches —
   then hangs up (`end_call`). It does **not** read jobs aloud.
5. **Dashboard:** open the `ui/` app, log in with your phone number, and review the
   matched jobs Convex computed.

> Tip: see `agent-py/debug/<room>.json` after a call for the captured profile.

## What's real vs mocked

| Real | Mocked / simplified |
|------|---------------------|
| LiveKit voice pipeline (STT/LLM/TTS), telephony wiring | Job corpus is demo data (`jobs.json` → Convex `jobs`, seeded on first run) |
| Per-caller Moss memory across calls (keyed by phone number) | Recommendation scoring is rule-based, not ML |
| Convex persistence: `careerProfiles`, `jobs`, `jobRecommendations` | No live job-board ingestion |
| Phone-OTP dashboard login (Convex Auth + Twilio) | — |
| Résumé extraction via Unsiloed | — |

## Current limitations

- Jobs are seeded demo data; no live job-board API yet.
- Matching is explainable rule-based scoring (in Convex `recommendJobs.ts`), not embeddings/ML.
- The local Python `recommendations.py` is no longer in the live call path (matching moved to Convex); it's kept for offline/debug use.
- No outbound calling; inbound only.

See **HACKATHON_PLAN.md** for cut features, stretch goals, and handoff notes.
