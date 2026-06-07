"""TTS selection for Matcha.

Default voice = LiveKit Inference TTS (reliable, always returns audio frames, no
provider key required) so Matcha actually speaks in the demo. MiniMax (the
sponsor TTS) is OPT-IN via env because it needs a valid MiniMax API key.

See https://docs.livekit.io/agents/models/tts/minimax/

NOTE on the single-segment wrapper:
    The bundled MiniMax plugin (v1.2.9) splits incoming text into sentences and
    emits a SEPARATE audio segment per sentence within one stream. The current
    livekit-agents framework (v1.5.16) rejects that pattern with:
        RuntimeError: start_segment() called before the previous segment was ended
    So we subclass its stream to buffer the whole utterance and emit exactly ONE
    segment.
"""

from __future__ import annotations

import logging
import os

from livekit.agents import inference

logger = logging.getLogger("agent.tts")

# Import the MiniMax TTS classes at MODULE LOAD TIME (main thread). LiveKit
# requires plugins to be registered on the main thread; doing the import here
# (this module is imported by agent.py at startup) avoids the
# "Plugins must be registered on the main thread" RuntimeError that occurs if
# the import happens lazily inside build_tts() on a worker thread.
try:
    import aiohttp

    from livekit.agents import APIConnectOptions, tts, utils
    from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS
    from livekit.plugins.minimax.tts import (
        TTS as _MinimaxTTS,
        SynthesizeStream as _MinimaxStream,
    )

    _MINIMAX_AVAILABLE = True
except ImportError:
    _MINIMAX_AVAILABLE = False


if _MINIMAX_AVAILABLE:

    class _SingleSegmentStream(_MinimaxStream):
        """MiniMax stream that buffers the full utterance into ONE segment.

        Avoids the multi-segment-per-stream pattern the framework rejects.
        """

        async def _run(self, emitter: "tts.AudioEmitter") -> None:
            request_id = utils.shortuuid()
            emitter.initialize(
                request_id=request_id,
                sample_rate=self._opts.sample_rate,
                mime_type="audio/pcm",
                stream=True,
                num_channels=1,
            )

            # Collect every token until the input channel closes, then synthesize
            # the whole thing as a single segment.
            parts: list[str] = []
            async for token in self._input_ch:
                if isinstance(token, self._FlushSentinel):
                    continue
                parts.append(token)

            text = "".join(parts).strip()
            if not text:
                return

            emitter.start_segment(segment_id=utils.shortuuid())
            logger.debug("MiniMax TTS (single segment): %s", text)
            data = self._opts.get_query_params(text=text)
            async with self._session.post(
                self._opts.get_http_url(),
                json=data,
                timeout=aiohttp.ClientTimeout(
                    total=300,
                    sock_connect=self._conn_options.timeout,
                ),
                headers=self._opts.get_http_header(),
            ) as resp:
                resp.raise_for_status()
                # The plugin squares the high-water mark to avoid stalls; mirror it.
                resp.content._high_water = resp.content._high_water**2
                import json as _json

                async for chunk in resp.content:
                    if chunk[:5] == b"data:":
                        payload = _json.loads(chunk[5:])
                        if "data" in payload and "extra_info" not in payload:
                            emitter.push(bytes.fromhex(payload["data"]["audio"]))
            emitter.end_segment()

    class MatchaMinimaxTTS(_MinimaxTTS):
        """MiniMax TTS that streams as a single segment (see module docstring)."""

        def stream(
            self, *, conn_options: "APIConnectOptions" = DEFAULT_API_CONNECT_OPTIONS
        ):
            return _SingleSegmentStream(
                tts=self,
                conn_options=conn_options,
                opts=self._opts,
                session=self._ensure_session(),
            )


def _build_inference_tts():
    """LiveKit Inference TTS — reliable, no provider key required, returns audio."""
    logger.info("Using LiveKit Inference TTS (reliable default voice)")
    return inference.TTS(
        model="cartesia/sonic-3", voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
    )


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def build_tts():
    """Return a TTS engine for Matcha.

    Default = LiveKit Inference TTS, which is rock-solid and always returns audio
    frames so Matcha actually speaks (this is what matters for the live demo).

    MiniMax (the sponsor TTS) is OPT-IN, because it requires a VALID MiniMax API
    key (a long JWT starting with `eyJ...`, NOT an `sk-...` key). With an invalid
    key MiniMax returns no audio frames and Matcha stays silent. Toggles:

        USE_MINIMAX_TTS=true     # try MiniMax (needs a valid MINIMAX_API_KEY)
        USE_FALLBACK_TTS=true    # force the Inference fallback even if the above is set

    See https://docs.livekit.io/agents/models/tts/minimax/
    """
    force_fallback = _env_truthy("USE_FALLBACK_TTS")
    want_minimax = _env_truthy("USE_MINIMAX_TTS")
    api_key = os.getenv("MINIMAX_API_KEY")
    group_id = os.getenv("MINIMAX_GROUP_ID")

    if want_minimax and not force_fallback:
        if not _MINIMAX_AVAILABLE:
            logger.warning(
                "USE_MINIMAX_TTS set but livekit-plugins-minimax is not installed; "
                "using Inference TTS instead."
            )
        elif not api_key:
            logger.warning(
                "USE_MINIMAX_TTS set but MINIMAX_API_KEY is missing; "
                "using Inference TTS instead."
            )
        else:
            try:
                kwargs = {}
                if group_id:
                    kwargs["group_id"] = group_id
                logger.info("Using MiniMax TTS for Matcha (USE_MINIMAX_TTS=true)")
                return MatchaMinimaxTTS(**kwargs)
            except Exception:
                logger.exception(
                    "Failed to initialize MiniMax TTS; using Inference TTS instead"
                )

    # Default reliable path — Matcha will speak.
    return _build_inference_tts()
