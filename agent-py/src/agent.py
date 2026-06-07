"""Matcha — a phone-first voice career discovery agent.

Matcha answers a phone call, runs a short career-discovery interview, and builds a
structured profile in real time. The actual role matching happens offline; Matcha
tells the caller it will follow up and does not read recommendations aloud.

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
    You have enough once you've recorded skills, interests, AND preferred_roles
    (`preferred_roles` comes from the JOB DESCRIPTIONS question). The remaining
    questions — company & culture, level, and pay — are nice-to-have: ask them if
    the caller is still engaged, but you may wrap up as soon as those three core
    fields are recorded.
    Then, in order:
    1. Say exactly: "Great, I have a good picture of you now."
    2. Tell the caller you'll do the matching on your side and call them back once
       you find roles that are a strong fit, and that in the meantime you've
       created a profile for them at matcha dot com where they can review and
       manage their applications.
    3. Do NOT read out job listings or career recommendations.
    4. Close warmly, for example: "Thanks for chatting with Matcha. We're gonna
       monitor open job positions and filter the best ones for you, and I'll call
       you back once I'm done with my analysis. In the meantime I created you a
       profile at matcha dot com — you can log in with your phone number to see
       your matching job postings. Thank you, goodbye."

    # Output format (voice / TTS)
    - Plain spoken text only: no markdown, lists, JSON, emojis, or code.
    - Spell out numbers; never read tool names or internal details aloud.
    - Say the website as "matcha dot com".
    - Keep it warm, concise, and conversational.
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
                preferred_roles, location_preferences, work_preferences,
                company_preferences, level, desired_salary.
            value: The value(s) to record. For list fields you may pass a
                comma-separated string (e.g. "python, react, sql"). name, level,
                and desired_salary hold a single value.
        """
        self.profile.update(field, value)
        self.profile.recompute_missing()
        logger.info("Profile updated [%s]: %s", field, value)
        logger.info("Current profile: %s", self.profile.to_json())
        await self._publish_profile()
        self._write_debug_snapshot()
        return f"Recorded {field}."

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

    # Matcha opens the call itself by following MATCHA_INSTRUCTIONS (introduce,
    # then ask the caller's name), so the opening stays in sync with the prompt
    # instead of a hardcoded greeting.
    await session.generate_reply(
        instructions=(
            "Start the call now: greet the caller, introduce yourself as Matcha, "
            "and ask for their name, following your opening instructions."
        )
    )



if __name__ == "__main__":
    cli.run_app(server)
