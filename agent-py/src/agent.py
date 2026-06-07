"""Matcha — a phone-first voice career discovery agent.

Matcha answers a phone call, runs a short career-discovery interview, builds a
structured profile in real time, then recommends 3 career paths and 5 matching
jobs — all spoken aloud over the call.

Stack:
- LiveKit Agents for telephony + voice orchestration
- LiveKit Inference for the LLM + STT (no provider key required)
- MiniMax for TTS (with an Inference fallback; see tts_setup.py)
- Moss for optional retrieval/memory (the demo path does not depend on it)

Run locally:   uv run python src/agent.py console
Run for phone: uv run python src/agent.py dev   (then connect a dispatch rule)
"""

import asyncio
import json
import logging
import os
import textwrap
import uuid

import httpx
from datetime import datetime, timezone

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    function_tool,
    inference,
    room_io,
)
from livekit.plugins import silero
from moss import DocumentInfo, MossClient, QueryOptions

from career_profile import CareerProfile

# Register the MiniMax TTS plugin on the MAIN THREAD at import time. LiveKit
# requires plugins to be registered on the main thread; importing it here (not
# lazily inside build_tts(), which runs on a worker thread) avoids the
# "Plugins must be registered on the main thread" RuntimeError.
try:
    from livekit.plugins import minimax  # noqa: F401
except ImportError:
    # Plugin not installed — tts_setup.build_tts() will fall back to Inference TTS.
    pass

from livekit.plugins.turn_detector.multilingual import MultilingualModel

# Local Python matchers (recommendations.py) are no longer wired into the live
# call — recommendations are computed in Convex via /api/recommend-jobs and
# surfaced in the user's dashboard. The file is kept on disk for fallback /
# debugging but is intentionally not imported here.
from tts_setup import build_tts

logger = logging.getLogger("agent")

# Load env from .env.local (LiveKit convention) and .env (spec convention).
# We search upward from this file so the project-root `.env` is found even when
# the agent is launched from inside agent-py/.
try:
    from dotenv import find_dotenv, load_dotenv

    # Local overrides first (agent-py/.env.local), then the nearest .env found
    # by walking up the tree (e.g. the project-root .env).
    load_dotenv(find_dotenv(".env.local", usecwd=True))
    load_dotenv(find_dotenv(".env", usecwd=True))
except ImportError:
    pass


# Where we drop a per-call debug snapshot (transcript + profile + recs).
DEBUG_DIR = os.getenv("MATCHA_DEBUG_DIR", "debug")

# Moss memory index: each fact is stored with metadata={"user_id": <phone>}
# so future calls from the same number can recall what the caller said before.
MEMORY_INDEX = os.getenv("MOSS_MEMORY_INDEX_NAME", "memory")
# When the SIP participant attribute is missing (console mode, browser test),
# fall back to a fixed id so the agent still runs.
DEFAULT_USER_ID = "matcha-local"

# Convex HTTP origin (e.g. https://<deployment>.convex.site). When set, we post
# the final CareerProfile snapshot at the end of `deliver_recommendations`
# so it lands in the canonical Convex `careerProfiles` row. Unset → skip.
CONVEX_SITE_URL = os.getenv("CONVEX_SITE_URL")
MATCHA_INGEST_SECRET = os.getenv("MATCHA_INGEST_SECRET")


def check_required_env() -> None:
    """Fail fast with a clear message if core LiveKit env vars are missing.

    Only LiveKit vars are strictly required to run/connect. Moss and MiniMax are
    optional (the agent degrades gracefully), so we warn instead of failing.
    """
    required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        # Console mode can run without these, so warn rather than hard-exit; the
        # LiveKit CLI itself will error clearly when a connection is needed.
        logger.warning(
            "Missing env vars: %s. Set them in .env (see .env.example). "
            "Required for connecting to LiveKit Cloud / telephony.",
            ", ".join(missing),
        )
    if not os.getenv("MINIMAX_API_KEY"):
        logger.warning("MINIMAX_API_KEY not set — Matcha will use fallback TTS.")


MATCHA_INSTRUCTIONS = textwrap.dedent(
    """\
        You are Matcha, a focused career-intake INTERVIEWER on a phone call. You are
        NOT a generic chatbot or assistant. Your ONLY job is to run a structured
        career-discovery interview: introduce yourself, get the caller's name, then
        work through the questions below, recording each answer, until you have enough
        to match the caller with careers.

        # Opening (do this first, in order)
        1. Introduce yourself and ask for the caller's name:
           "Hi, I'm Matcha, and I'm gonna match you to a job. No honestly, I help
           people find their next role. Who am I talking with?"
        2. When the caller gives their name say: "Nice to talk to you. Tell
           me a little about yourself."
        3. Treat their reply to "tell me about yourself" as their self-introduction —
           pull any facts from it (experience, skills, interests, ...) before moving
           on to the flow.

        # Hard rules (follow every turn, no exceptions)
        - Keep every reply to 1–2 short sentences. This is a phone call, not a lecture.
        - Do NOT chit-chat, give advice, explain concepts, or answer off-topic
          questions. If the caller goes off-topic, briefly acknowledge in one short
          phrase, then immediately ask the next interview question.
        - Don't re-ask something the caller already answered — always move forward
          through the flow. The ONE exception: if you genuinely didn't understand the
          answer, first briefly apologize and say you didn't catch it (e.g. "Sorry, I
          didn't quite catch that"), THEN ask the same question again.
        - After EACH caller answer: silently call the `update_profile` tool for any
          new facts (one field per call), then ask the NEXT question in the flow.
        - Do not invent data. Record only what the caller actually said.

        # Interview flow — ask in THIS ORDER, recording to the field(s) shown
        If the caller already answered an upcoming question earlier (e.g. in their
        intro), skip it and move on — never re-ask something you already know.

        1. EXPERIENCE  → record as `experience`
           "What experience do you have, and what kinds of work have you done before?"
        2. SKILLS  → record as `skills`
           "What skills do you use most often, and which tools, languages, or
           platforms are you most comfortable with?"
        3. INTERESTS  → record as `interests`
           "What kind of work do you enjoy most, and what industries or company types
           interest you?"
        4. LOCATION & WORK PREFERENCES  → record as `location_preferences` and
           `work_preferences`
           "Where are you looking to work, and are you open to remote, hybrid, or
           in-person roles?"
        5. EDUCATION  → record as `education`
           "What level of education do you have? Tell me anything you think is
           noteworthy about your education and related extracurriculars."
        6. JOB DESCRIPTIONS  → record as `preferred_roles`
           "Have you seen any job postings recently that interested you, and what did
           you like about them?"
        7. COMPANY & CULTURE  → record as `company_preferences`
           "Do you prefer startups, established companies, or something in between?"
        8. LEVEL & GROWTH  → record the level as `level` and any pay expectation as
           `desired_salary`
           "What level are you looking for, like junior, mid, or senior? And do you
           have any idea how much you'd like to earn?"

        Adapt wording naturally and use the caller's name once you know it.

        # When to stop interviewing and wrap up
        You have enough once you've recorded skills, interests, AND preferred_roles.
        The remaining questions (company & culture, level, pay) are nice-to-have —
        ask them if the caller is engaged, but you can wrap up as soon as the three
        core fields are recorded. Also wrap up if the caller is clearly disengaged
        or wants to stop.

        Speak EXACTLY ONE conclusion (no preamble + close), then call the
        `end_call` tool. Do NOT read job listings or career recommendations.
        Do NOT repeat or paraphrase your conclusion.

        Pick the conclusion based on what you actually recorded:

        - STRONG close — use this only when `skills`, `interests`, AND
          `preferred_roles` are all recorded. Tell the caller you have what you
          need, you'll match them against open roles in the background, and they
          can log in at matcha dot com with their phone number to see their
          matches on the dashboard. Then say a warm goodbye in the same breath.
          Example: "Great, I've got what I need. I'm gonna match you against
          open roles right now and drop the best ones on your dashboard at
          matcha dot com — log in with your phone number any time. Thanks for
          chatting with Matcha, talk soon."

        - LIGHT close — use this when one or more of the three core fields is
          still empty (e.g. caller is hanging up early or wasn't sure). Be
          honest: tell them you didn't quite get enough to match them yet and
          invite them to call back. Do NOT claim you created a profile or
          generated matches. Example: "I didn't quite get enough to match you
          to roles this time — call me back any time and we'll pick up where we
          left off. Thanks, take care."

        Immediately after the goodbye sentence, call `end_call` to hang up.

        # Output format (voice / TTS)
        - Plain spoken text only: no markdown, lists, JSON, emojis, or code.
        - Spell out numbers; never read tool names or internal details aloud.
        - Say the website as "matcha dot com".
        - Keep it warm, concise, and conversational.
        """
)


class Matcha(Agent):
    """The Matcha career interview agent. Holds the in-memory profile."""

    def __init__(
        self,
        *,
        room=None,
        job_ctx: JobContext | None = None,
        call_id: str = "local",
        user_id: str = DEFAULT_USER_ID,
    ) -> None:
        super().__init__(
            llm=inference.LLM(model="openai/gpt-5.2-chat-latest"),
            instructions=MATCHA_INSTRUCTIONS,
        )
        self._room = room
        self._job_ctx = job_ctx
        self._call_id = call_id
        self._user_id = user_id
        self.profile = CareerProfile()
        self._recommended = False
        self._convex_triggered = False

        # Moss is optional: if credentials are missing, the memory tools no-op
        # and the rest of the interview still works.
        moss_project_id = os.getenv("MOSS_PROJECT_ID")
        moss_project_key = os.getenv("MOSS_PROJECT_KEY")
        if moss_project_id and moss_project_key:
            self._moss = MossClient(moss_project_id, moss_project_key)
        else:
            self._moss = None
            logger.warning(
                "Moss credentials missing — memory tools will no-op for this call."
            )
        self._memory_loaded = False

    def set_user_id(self, user_id) -> None:
        """Update the user identity once we learn the caller's phone number.

        Called from the entrypoint after the SIP participant joins. Tools that
        index/recall facts use `self._user_id` as the Moss metadata key.

        Defensively rejects non-strings so we never index against a MagicMock or
        other sentinel produced by the LiveKit CLI's console-mode fake.
        """
        if isinstance(user_id, str) and user_id:
            self._user_id = user_id
            logger.info("Matcha user_id set to %s", user_id)

    async def _ensure_memory_index_loaded(self) -> None:
        if self._moss is None or self._memory_loaded:
            return
        try:
            await self._moss.load_index(MEMORY_INDEX)
            self._memory_loaded = True
            logger.info("Loaded Moss memory index '%s'", MEMORY_INDEX)
        except Exception:
            logger.exception("Failed to load Moss memory index; will retry on use")

    async def load_prior_context(self, top_k: int = 20) -> list[str]:
        """Pull prior facts about this caller from Moss to bootstrap the call.

        Returns the de-duped, non-empty text of the top-k memory docs scoped to
        the current `user_id` (i.e. this phone number). Used by the entrypoint
        to personalize the opening greeting for returning callers.
        """
        if self._moss is None:
            return []
        await self._ensure_memory_index_loaded()
        try:
            result = await self._moss.query(
                MEMORY_INDEX,
                "candidate background skills experience preferences career goals",
                QueryOptions(
                    top_k=top_k,
                    filter={
                        "field": "user_id",
                        "condition": {"$eq": self._user_id},
                    },
                ),
            )
        except Exception:
            logger.exception("Failed to load prior context from Moss")
            return []
        docs = getattr(result, "docs", None) or []
        out: list[str] = []
        seen: set[str] = set()
        for d in docs:
            text = (getattr(d, "text", "") or "").strip()
            if text and text not in seen:
                seen.add(text)
                out.append(text)
        return out

    async def _index_fact(self, fact: str) -> None:
        """Persist a single fact to the Moss memory index, scoped to this user."""
        if self._moss is None or not fact:
            return
        await self._ensure_memory_index_loaded()
        try:
            doc = DocumentInfo(
                id=f"{self._user_id}-{uuid.uuid4()}",
                text=fact,
                metadata={"user_id": self._user_id, "call_id": self._call_id},
            )
            await self._moss.add_docs(MEMORY_INDEX, [doc])
            # Reload so subsequent recalls see this write.
            await self._moss.load_index(MEMORY_INDEX)
        except Exception:
            logger.exception("Failed to index fact to Moss")

    async def _post_profile_snapshot(self) -> None:
        """POST the final CareerProfile snapshot to Convex.

        Skips silently in console mode (no real phone number) and when
        `CONVEX_SITE_URL` isn't configured. Called from
        `_fetch_job_recommendations_from_convex` and from the shutdown
        callback in the entrypoint as a fallback for early hangups.
        """
        logger.info(
            "[convex] profile snapshot requested — user_id=%s call_id=%s CONVEX_SITE_URL=%s INGEST_SECRET=%s",
            self._user_id,
            self._call_id,
            "set" if CONVEX_SITE_URL else "unset",
            "set" if MATCHA_INGEST_SECRET else "unset",
        )
        if not CONVEX_SITE_URL:
            logger.warning("[convex] skipping POST: CONVEX_SITE_URL not configured")
            return
        if not self._user_id.startswith("+"):
            # E.164 phone numbers always start with `+`. Skip console / fallback
            # ids so we don't pollute Convex with sentinel rows.
            logger.warning(
                "[convex] skipping POST: user_id %s does not look like an E.164 phone number",
                self._user_id,
            )
            return

        payload = dict(self.profile.to_dict())
        payload["phone_number"] = self._user_id

        headers = {"Content-Type": "application/json"}
        if MATCHA_INGEST_SECRET:
            headers["x-matcha-secret"] = MATCHA_INGEST_SECRET

        url = f"{CONVEX_SITE_URL.rstrip('/')}/api/career-profile"
        logger.info(
            "[convex] POST %s — keys=%s len(payload)=%d",
            url,
            sorted(payload.keys()),
            len(json.dumps(payload)),
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                logger.info(
                    "[convex] /api/career-profile responded status=%s body=%s",
                    response.status_code,
                    response.text[:500],
                )
                if response.status_code >= 400:
                    logger.error(
                        "[convex] profile snapshot POST failed: %s %s",
                        response.status_code,
                        response.text,
                    )
        except Exception:
            logger.exception("[convex] /api/career-profile request raised")

    async def _trigger_convex_job_recommendations(self, top_n: int = 3) -> None:
        """Fire-and-forget: upsert profile + ask Convex to compute recs.

        The agent doesn't speak the result — recommendations land in the
        `jobRecommendations` table and surface in the user's dashboard. We log
        the response for visibility but don't return anything to the caller,
        so callers should kick this off via `asyncio.create_task` and move on.
        """
        if self._convex_triggered:
            logger.info("[convex] recommend-jobs already triggered — skipping")
            return
        self._convex_triggered = True

        logger.info(
            "[convex] recommend-jobs trigger — user_id=%s top_n=%d",
            self._user_id,
            top_n,
        )
        if not CONVEX_SITE_URL:
            logger.warning("[convex] skipping recommend-jobs: CONVEX_SITE_URL unset")
            return
        if not self._user_id.startswith("+"):
            logger.warning(
                "[convex] skipping recommend-jobs: user_id %s is not an E.164 phone",
                self._user_id,
            )
            return

        # Profile must exist before the recommend endpoint can score it.
        await self._post_profile_snapshot()

        headers = {"Content-Type": "application/json"}
        if MATCHA_INGEST_SECRET:
            headers["x-matcha-secret"] = MATCHA_INGEST_SECRET

        url = f"{CONVEX_SITE_URL.rstrip('/')}/api/recommend-jobs"
        payload = {"phone_number": self._user_id, "top_n": top_n}
        logger.info("[convex] POST %s — payload=%s", url, payload)

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json=payload, headers=headers)
            logger.info(
                "[convex] /api/recommend-jobs responded status=%s body=%s",
                response.status_code,
                response.text[:500],
            )
        except Exception:
            logger.exception("[convex] /api/recommend-jobs request raised")

    # ------------------------------------------------------------------
    # Tools the LLM calls during the interview
    # ------------------------------------------------------------------
    @function_tool()
    async def update_profile(self, context: RunContext, field: str, value: str) -> str:
        """Record a fact the caller shared into their career profile.

        Call this after each answer for any new information you heard. Extract
        only what was actually said; do not guess.

        Args:
            field: One of name, skills, experience, education, interests,
                preferred_roles, location_preferences, work_preferences.
            value: The value(s) to record. For list fields you may pass a
                comma-separated string (e.g. "python, react, sql").
        """
        self.profile.update(field, value)
        self.profile.recompute_missing()
        logger.info("Profile updated [%s]: %s", field, value)
        logger.info("Current profile: %s", self.profile.to_json())
        await self._publish_profile()
        self._write_debug_snapshot()
        # Index the structured fact into the per-caller Moss memory so future
        # calls from this phone number can recall it via recall_facts.
        await self._index_fact(f"{field}: {value}")
        return f"Recorded {field}."

    @function_tool()
    async def end_call(self, context: RunContext) -> str:
        """End the phone call. Call this EXACTLY ONCE, immediately after your
        final goodbye line. Do not say anything after invoking this tool — the
        line will be torn down.
        """
        logger.info("[end_call] tool invoked — scheduling room teardown")
        # Kick off the Convex hand-off in the background so the user's
        # dashboard fills in even if `deliver_recommendations` was never used.
        try:
            asyncio.create_task(self._trigger_convex_job_recommendations())
        except Exception:
            logger.exception("[end_call] failed to schedule convex trigger")
        # Give TTS a beat to finish speaking the goodbye before deleting the
        # room — TTS playout runs slightly behind the LLM tool call.
        await asyncio.sleep(2.5)
        if self._job_ctx is not None:
            try:
                fut = self._job_ctx.delete_room()
                if fut is not None:
                    await fut
                logger.info("[end_call] room deletion submitted")
            except Exception:
                logger.exception("[end_call] delete_room failed")
        else:
            logger.warning("[end_call] no JobContext available; cannot delete room")
        return ""

    @function_tool()
    async def remember_fact(self, context: RunContext, fact: str) -> str:
        """Persist a durable, free-form fact the caller shared.

        Use this on top of `update_profile` when the caller mentions something
        that doesn't fit a profile field but is worth recalling next time they
        call (e.g. "moving to Berlin in March", "kid just started school").

        Args:
            fact: A short, self-contained statement.
        """
        await self._index_fact(fact)
        return "Got it, I'll remember that."

    @function_tool()
    async def recall_facts(self, context: RunContext, query: str) -> str:
        """Recall facts this caller shared on previous calls.

        Scoped by the caller's phone number, so the agent only sees what this
        specific caller said before. Useful at the start of a return call.

        Args:
            query: What you want to recall about the caller.
        """
        if self._moss is None:
            return "I don't have any memory available right now."
        await self._ensure_memory_index_loaded()
        try:
            result = await self._moss.query(
                MEMORY_INDEX,
                query,
                QueryOptions(
                    top_k=5,
                    filter={
                        "field": "user_id",
                        "condition": {"$eq": self._user_id},
                    },
                ),
            )
        except Exception:
            logger.exception("Moss recall failed")
            return "I couldn't pull up your history just now."
        docs = getattr(result, "docs", None) or []
        facts = [(getattr(d, "text", "") or "").strip() for d in docs]
        facts = [f for f in facts if f]
        if not facts:
            return "I don't have anything remembered for you yet."
        return "\n".join(facts)

    # ------------------------------------------------------------------
    # Debug surfaces: console logs, local JSON file, and data messages
    # ------------------------------------------------------------------
    def _write_debug_snapshot(self, roles=None, jobs=None) -> None:
        """Write the current profile (+ optional recs) to a local JSON file."""
        try:
            os.makedirs(DEBUG_DIR, exist_ok=True)
            snapshot = {
                "call_id": self._call_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "profile": self.profile.to_dict(),
            }
            if roles is not None:
                snapshot["recommended_roles"] = [
                    {"role": r.role, "score": r.score, "rationale": r.rationale}
                    for r in roles
                ]
            if jobs is not None:
                snapshot["matched_jobs"] = [
                    {
                        "title": j.job.get("title"),
                        "company": j.job.get("company"),
                        "score": j.score,
                        "reasons": j.reasons,
                    }
                    for j in jobs
                ]
            path = os.path.join(DEBUG_DIR, f"{self._call_id}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, indent=2)
        except Exception:
            logger.exception("Failed to write debug snapshot")

    async def _publish_profile(self) -> None:
        """Send the live profile to any connected frontend (optional debug UI)."""
        await self._publish({"type": "matcha_profile", "data": self.profile.to_dict()})

    async def _publish(self, payload: dict) -> None:
        if self._room is None:
            return
        try:
            encoded = json.dumps(payload, default=str).encode("utf-8")
            await self._room.local_participant.publish_data(
                payload=encoded, reliable=True
            )
        except Exception:
            logger.exception("Failed to publish data message")


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


# Keep the registered dispatch name as "agent-py" so existing dispatch config
# (and the frontend) continue to route here. Telephony dispatch rules target
# this agent name — see README "Telephony" section.
@server.rtc_session(agent_name="agent-py")
async def matcha_agent(ctx: JobContext):
    check_required_env()

    ctx.log_context_fields = {"room": ctx.room.name}

    # Use the room name as a stable per-call id for debug snapshots.
    call_id = ctx.room.name or "local"

    # We don't know the caller's phone number yet — it arrives as a SIP
    # participant attribute after `ctx.connect()`. Start with the fallback id
    # and update Matcha once the participant joins.
    matcha = Matcha(room=ctx.room, job_ctx=ctx, call_id=call_id)

    session = AgentSession(
        # STT via LiveKit Inference (the agent's ears).
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        # TTS prefers MiniMax (sponsor), falls back to Inference. See tts_setup.py
        tts=build_tts(),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    await session.start(
        agent=matcha,
        room=ctx.room,
        room_options=room_io.RoomOptions(),
    )

    await ctx.connect()

    # Pull the caller's phone number off the SIP participant. Telephony attrs
    # land on the participant LiveKit injects for the inbound call; without it
    # (console / browser test) we keep DEFAULT_USER_ID. Once we know who is
    # calling, hit Moss for anything we recorded on prior calls so the greeting
    # can recognize returning callers.
    prior_facts: list[str] = []
    try:
        participant = await ctx.wait_for_participant()
        logger.info(
            "[sip] participant joined identity=%s kind=%s attributes=%s",
            getattr(participant, "identity", None),
            getattr(participant, "kind", None),
            dict(getattr(participant, "attributes", {}) or {}),
        )
        phone_number = participant.attributes.get("sip.phoneNumber")
        # In console mode the participant is a MagicMock, so `attributes.get`
        # also returns a MagicMock — type-check before using it as an id. When
        # we can't resolve a real phone number we keep DEFAULT_USER_ID so
        # repeat console sessions still exercise the returning-caller path.
        if isinstance(phone_number, str) and phone_number:
            logger.info("[sip] resolved phone_number=%s", phone_number)
            matcha.set_user_id(phone_number)
        else:
            logger.warning(
                "[sip] no usable sip.phoneNumber attribute; raw=%r — using fallback user_id=%s",
                phone_number,
                matcha._user_id,
            )
    except Exception:
        logger.exception("Failed to read caller phone number from SIP attributes")

    # Safety net: if the call ends BEFORE `deliver_recommendations` fires, we
    # still want the latest CareerProfile snapshot to land in Convex. The
    # shutdown callback runs on session/room teardown.
    async def _on_shutdown() -> None:
        logger.info(
            "[shutdown] callback firing — user_id=%s convex_triggered=%s",
            matcha._user_id,
            matcha._convex_triggered,
        )
        if matcha._convex_triggered:
            # Either the `end_call` tool or a prior path already kicked off
            # the Convex POST + recommend-jobs trigger.
            return
        # Fire-and-forget — we don't want the room teardown to wait on Convex
        # round-trips. The task lives long enough to complete because the LK
        # runtime keeps the event loop alive through pending tasks.
        try:
            asyncio.create_task(matcha._trigger_convex_job_recommendations())
            logger.info("[shutdown] scheduled convex hand-off")
        except Exception:
            logger.exception("[shutdown] failed to schedule convex hand-off")

    try:
        ctx.add_shutdown_callback(_on_shutdown)
        logger.info("[shutdown] registered profile-snapshot fallback")
    except Exception:
        logger.exception("Failed to register shutdown callback")

    # Always attempt the recall — for real calls this is filtered to the
    # phone number; for console mode it uses DEFAULT_USER_ID so prior
    # console sessions surface as "returning caller" facts.
    try:
        prior_facts = await matcha.load_prior_context()
    except Exception:
        logger.exception("Failed to load prior context from Moss")

    if prior_facts:
        # Inject prior knowledge as a system note BEFORE the first turn so the
        # LLM treats the caller as returning. Skip the questions already covered
        # and confirm what changed.
        note = (
            "This caller has called you before. Here is what you previously "
            "recorded about them, indexed by their phone number:\n- "
            + "\n- ".join(prior_facts)
            + "\n\nDo NOT re-ask for facts above. Briefly acknowledge that you "
            "remember them, mention one concrete detail to show recognition, "
            "and ask whether their situation has changed since last time. "
            "Only ask follow-up interview questions to fill gaps."
        )
        new_ctx = matcha.chat_ctx.copy()
        new_ctx.add_message(role="system", content=note)
        await matcha.update_chat_ctx(new_ctx)
        logger.info(
            "Returning caller %s — loaded %d prior facts from Moss",
            matcha._user_id,
            len(prior_facts),
        )
        await session.generate_reply(
            instructions=(
                "Greet this returning caller warmly in ONE short sentence "
                "(use their name if you know it), mention one specific detail "
                "you remember about them to show recognition, then ask in a "
                "second short sentence whether their situation has changed."
            )
        )
    else:
        # First-time caller (or no Moss creds) — use the deterministic greeting
        # so the interview always starts the same way.
        await session.say(
            "Hi, I'm Matcha. I help people discover career paths that really "
            "fit who they are. To get started, can you tell me a little about "
            "yourself?"
        )


if __name__ == "__main__":
    cli.run_app(server)
