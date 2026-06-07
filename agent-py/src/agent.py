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

from llm_recommend import LlmMatchError, llm_match_jobs
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

    def __init__(self, *, room=None, call_id: str = "local") -> None:
        super().__init__(
            llm=inference.LLM(model="openai/gpt-5.2-chat-latest"),
            instructions=MATCHA_INSTRUCTIONS,
        )
        self._room = room
        self._call_id = call_id
        self.profile = CareerProfile()
        self._recommended = False

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
        transcript = self._extract_transcript()
        jobs, engine = self._match_jobs_with_fallback(categories, transcript)

        speech = format_recommendations_for_speech(roles, jobs)
        self._recommended = True

        logger.info(
            "=== RECOMMENDATIONS for call %s (job matcher: %s) ===",
            self._call_id,
            engine,
        )
        for r in roles:
            logger.info("Role: %s (score %s) — %s", r.role, r.score, r.rationale)
        for j in jobs:
            logger.info(
                "Job: %s @ %s (score %s)",
                j.job.get("title"),
                j.job.get("company"),
                j.score,
            )

        await self._publish_recommendations(roles, jobs, engine=engine)
        self._write_debug_snapshot(roles=roles, jobs=jobs, engine=engine)
        return speech

    # ------------------------------------------------------------------
    # Job matching: LLM rank-and-explain, with keyword fallback
    # ------------------------------------------------------------------
    def _match_jobs_with_fallback(
        self, categories: list[str], transcript: list[dict]
    ) -> tuple[list, str]:
        """Rank jobs with the LLM matcher, falling back to the keyword matcher.

        Returns ``(matches, engine)`` where ``engine`` is ``"llm"`` or
        ``"keyword_fallback"``. The fallback fires on any LLM error/timeout OR
        when the LLM returns nothing above the relevance bar — and is always
        logged loudly so it's obvious which engine produced the result.
        """
        try:
            matches = llm_match_jobs(
                self.profile.to_dict(), transcript=transcript, top_n=5
            )
            if matches:
                logger.info(
                    "✓ Job matcher: LLM rank-and-explain (%d matches)", len(matches)
                )
                return matches, "llm"
            logger.warning(
                "⚠ LLM matcher returned no jobs above the relevance bar "
                "— using KEYWORD FALLBACK"
            )
        except LlmMatchError as e:
            logger.warning("⚠ LLM matcher unavailable (%s) — using KEYWORD FALLBACK", e)
        except Exception:
            logger.exception("⚠ LLM matcher crashed — using KEYWORD FALLBACK")

        matches = match_jobs(self.profile, recommended_categories=categories, top_n=5)
        return matches, "keyword_fallback"

    def _extract_transcript(self) -> list[dict]:
        """Pull the conversation so far into ``[{role, text}]`` for the matcher.

        UNVERIFIED: the chat-history API can change across livekit-agents
        versions — verify against https://docs.livekit.io. We read defensively
        and fall back to an empty transcript (profile-only matching) on any error,
        so a changed API degrades gracefully rather than breaking the call.
        """
        turns: list[dict] = []
        try:
            chat_ctx = getattr(self, "chat_ctx", None)
            for item in getattr(chat_ctx, "items", None) or []:
                role = getattr(item, "role", None)
                if role not in ("user", "assistant"):
                    continue
                text = getattr(item, "text_content", None)
                if callable(text):
                    text = text()
                if not text:
                    content = getattr(item, "content", None)
                    if isinstance(content, list):
                        text = " ".join(c for c in content if isinstance(c, str))
                    elif isinstance(content, str):
                        text = content
                if text:
                    turns.append(
                        {
                            "role": "agent" if role == "assistant" else "user",
                            "text": text,
                        }
                    )
        except Exception:
            logger.exception("Failed to extract transcript; matching on profile only")
        return turns

    # ------------------------------------------------------------------
    # Debug surfaces: console logs, local JSON file, and data messages
    # ------------------------------------------------------------------
    def _write_debug_snapshot(self, roles=None, jobs=None, engine=None) -> None:
        """Write the current profile (+ optional recs) to a local JSON file."""
        try:
            os.makedirs(DEBUG_DIR, exist_ok=True)
            snapshot = {
                "call_id": self._call_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "profile": self.profile.to_dict(),
            }
            if engine is not None:
                # Which job matcher produced these results: "llm" or
                # "keyword_fallback". Makes fallback usage visible in the snapshot.
                snapshot["job_matcher_engine"] = engine
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

    async def _publish_recommendations(self, roles, jobs, engine: str = "llm") -> None:
        await self._publish(
            {
                "type": "matcha_recommendations",
                "data": {
                    # "llm" or "keyword_fallback" — lets the UI badge the source.
                    "engine": engine,
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
        agent=Matcha(room=ctx.room, call_id=call_id),
        room=ctx.room,
        room_options=room_io.RoomOptions(),
    )

    await ctx.connect()

    # Matcha opens the call with a fixed greeting so the interview always starts
    # the same way (deterministic — not left up to the LLM). session.say() speaks
    # this exact text via TTS. After this, the LLM follows MATCHA_INSTRUCTIONS
    # and runs the structured interview one question at a time.
    await session.say(
        "Hi, I'm Matcha. I help people discover career paths that really fit "
        "who they are. To get started, can you tell me a little about yourself?"
    )


if __name__ == "__main__":
    cli.run_app(server)
