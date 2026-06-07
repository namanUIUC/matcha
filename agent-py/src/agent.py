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

import json
import logging
import os
import textwrap
import uuid
from datetime import datetime, timezone

from career_profile import CareerProfile
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

from recommendations import (
    format_recommendations_for_speech,
    match_jobs,
    recommend_roles,
)
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
    career-discovery interview: ask one question, listen, record the answer, then
    ask the next question — until you have enough to recommend careers.

    # Hard rules (follow every turn, no exceptions)
    - Ask EXACTLY ONE question per turn. Never ask two questions at once.
    - Keep every reply to 1–2 short sentences. This is a phone call, not a lecture.
    - Do NOT chit-chat, give advice, explain concepts, or answer off-topic
      questions. If the caller goes off-topic, briefly acknowledge in one short
      phrase, then immediately ask the next interview question.
    - Never repeat a question you already asked. Move forward through the flow.
    - After EACH caller answer: silently call the `update_profile` tool for any
      new facts (one field per call), then ask the NEXT question in the flow.
    - Do not invent data. Record only what the caller actually said.

    # Interview flow — ask in THIS ORDER, one question per turn
    The greeting ("tell me about yourself") is already sent, so begin at step 1
    after their first answer.

    1. EXPERIENCE — "What experience do you have, and what kinds of work have you
       done before?"
    2. SKILLS — "What skills do you use most often, and which tools, languages, or
       platforms are you most comfortable with?"
    3. INTERESTS — "What kind of work do you enjoy most, and what industries or
       company types interest you?"
    4. LOCATION & WORK PREFERENCES — "Where are you looking to work, and are you
       open to remote, hybrid, or in-person roles?"
    5. ROLE & RESPONSIBILITY — "What kind of role are you looking for, and what do
       you want to be doing day-to-day?"
    6. JOB DESCRIPTIONS — "Have you seen any job postings recently that interested
       you, and what did you like about them?"
    7. COMPANY & CULTURE — "Do you prefer startups, established companies, or
       something in between?"
    8. LEVEL & GROWTH — "What level are you looking for, like junior, mid, or
       senior?"

    Adapt wording naturally and use the caller's name once you know it, but keep
    the same order and one-question-at-a-time rule.

    # When to stop interviewing and give recommendations
    Stop asking questions once EITHER:
      - you have skills, interests, AND preferred roles recorded, OR
      - the caller has answered about 5 to 7 questions.
    Then do this, in order:
      1. Say exactly: "Great, I have a good picture of you now. Based on what
         you've told me, here are some career paths that might be a good fit."
      2. Call the `deliver_recommendations` tool.
      3. Read its returned text to the caller naturally: 3 career paths with short
         reasons, then 5 matching job openings.
      4. Close warmly: "Thanks for chatting with Matcha. Good luck with your
         career search."

    # Output format (voice/TTS)
    - Plain spoken text only: no markdown, lists, JSON, emojis, or code.
    - Spell out numbers; never read tool names or internal details aloud.
    - If you didn't understand, say "I'm not sure I caught that" and re-ask the
      same question once.
    """
)



class Matcha(Agent):
    """The Matcha career interview agent. Holds the in-memory profile."""

    def __init__(
        self,
        *,
        room=None,
        call_id: str = "local",
        user_id: str = DEFAULT_USER_ID,
    ) -> None:
        super().__init__(
            llm=inference.LLM(model="openai/gpt-5.2-chat-latest"),
            instructions=MATCHA_INSTRUCTIONS,
        )
        self._room = room
        self._call_id = call_id
        self._user_id = user_id
        self.profile = CareerProfile()
        self._recommended = False

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

    # ------------------------------------------------------------------
    # Tools the LLM calls during the interview
    # ------------------------------------------------------------------
    @function_tool()
    async def update_profile(
        self, context: RunContext, field: str, value: str
    ) -> str:
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
    async def deliver_recommendations(self, context: RunContext) -> str:
        """Compute and return spoken-ready career path + job recommendations.

        Call this once you have enough of the caller's profile (at least skills,
        interests, and preferred roles). Read the returned text to the caller,
        then briefly explain why the matches fit.
        """
        roles = recommend_roles(self.profile, top_n=3)
        categories = [r.category for r in roles]
        jobs = match_jobs(self.profile, recommended_categories=categories, top_n=5)

        speech = format_recommendations_for_speech(roles, jobs)
        self._recommended = True

        logger.info("=== RECOMMENDATIONS for call %s ===", self._call_id)
        for r in roles:
            logger.info("Role: %s (score %s) — %s", r.role, r.score, r.rationale)
        for j in jobs:
            logger.info(
                "Job: %s @ %s (score %s)",
                j.job.get("title"),
                j.job.get("company"),
                j.score,
            )

        await self._publish_recommendations(roles, jobs)
        self._write_debug_snapshot(roles=roles, jobs=jobs)
        return speech

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

    async def _publish_recommendations(self, roles, jobs) -> None:
        await self._publish(
            {
                "type": "matcha_recommendations",
                "data": {
                    "roles": [
                        {"role": r.role, "score": r.score, "rationale": r.rationale}
                        for r in roles
                    ],
                    "jobs": [
                        {
                            "title": j.job.get("title"),
                            "company": j.job.get("company"),
                            "location": j.job.get("location"),
                            "score": j.score,
                            "reasons": j.reasons,
                        }
                        for j in jobs
                    ],
                },
            }
        )

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
    matcha = Matcha(room=ctx.room, call_id=call_id)

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
        phone_number = participant.attributes.get("sip.phoneNumber")
        # In console mode the participant is a MagicMock, so `attributes.get`
        # also returns a MagicMock — type-check before using it as an id. When
        # we can't resolve a real phone number we keep DEFAULT_USER_ID so
        # repeat console sessions still exercise the returning-caller path.
        if isinstance(phone_number, str) and phone_number:
            matcha.set_user_id(phone_number)
    except Exception:
        logger.exception("Failed to read caller phone number from SIP attributes")

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
