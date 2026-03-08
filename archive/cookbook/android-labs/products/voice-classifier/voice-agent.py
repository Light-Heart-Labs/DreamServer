"""
Dream Server Voice Agent (v3.1)
Real-time voice conversation using local LLM + STT + TTS

Uses LiveKit Agents SDK v1.4+ with local model backends:
- LLM: vLLM (OpenAI-compatible)
- STT: Whisper (OpenAI-compatible API)
- TTS: Kokoro (OpenAI-compatible API)
- VAD: Silero (built-in)

Features:
- Error handling with graceful degradation
- Service health checks before startup
- Reconnection logic for LiveKit
- Interrupt handling (user can stop bot speech)
"""

import logging
import os
import asyncio
import signal
from typing import Optional

from dotenv import load_dotenv
from livekit.agents import (
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
)
from livekit.agents import Agent, AgentSession
from livekit.plugins import silero, openai as openai_plugin

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(name)s | %(levelname)s | %(message)s'
)
logger = logging.getLogger("dream-voice")

# Environment config
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
LLM_URL = os.getenv("LLM_URL", "http://localhost:8000/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-32B-Instruct-AWQ")
STT_URL = os.getenv("STT_URL", "http://localhost:8001")
TTS_URL = os.getenv("TTS_URL", "http://localhost:8880")
TTS_VOICE = os.getenv("TTS_VOICE", "af_heart")

# Feature flags for graceful degradation
ENABLE_STT = os.getenv("ENABLE_STT", "true").lower() == "true"
ENABLE_TTS = os.getenv("ENABLE_TTS", "true").lower() == "true"
ENABLE_INTERRUPTIONS = os.getenv("ENABLE_INTERRUPTIONS", "true").lower() == "true"


async def check_service_health(url: str, name: str, timeout: int = 5) -> bool:
    """Check if a service is healthy before starting."""
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                healthy = resp.status == 200
                if healthy:
                    logger.info(f"✓ {name} is healthy")
                else:
                    logger.warning(f"⚠ {name} returned status {resp.status}")
                return healthy
    except Exception as e:
        logger.warning(f"✗ {name} unreachable: {e}")
        return False


class DreamVoiceAgent(Agent):
    """
    Voice agent with robust error handling and graceful degradation.
    
    Features:
    - Greets user on entry
    - Handles interruptions (user can stop bot speech)
    - Falls back gracefully if services fail
    """
    
    def __init__(self) -> None:
        super().__init__(
            instructions="""You are a helpful voice assistant running on local hardware.
You have access to a powerful GPU cluster running Qwen2.5 32B for language understanding.
Keep responses conversational and concise - this is voice, not text.
Be friendly, direct, and helpful.""",
            # Enable interruption handling
            allow_interruptions=ENABLE_INTERRUPTIONS,
        )
        self.error_count = 0
        self.max_errors = 3
    
    async def on_enter(self):
        """Called when agent becomes active. Send greeting."""
        logger.info("Agent entered - sending greeting")
        try:
            self.session.generate_reply(
                instructions="Greet the user warmly and briefly introduce yourself as their local voice assistant."
            )
        except Exception as e:
            logger.error(f"Failed to send greeting: {e}")
            self.error_count += 1
    
    async def on_exit(self):
        """Called when agent is shutting down."""
        logger.info("Agent exiting - cleanup")
    
    async def on_error(self, error: Exception):
        """Handle errors gracefully."""
        self.error_count += 1
        logger.error(f"Agent error ({self.error_count}/{self.max_errors}): {error}")
        
        if self.error_count >= self.max_errors:
            logger.critical("Max errors reached, agent will restart")
            # Signal for restart
            raise error


async def create_llm() -> Optional[openai_plugin.LLM]:
    """Create LLM with error handling."""
    try:
        llm = openai_plugin.LLM(
            model=LLM_MODEL,
            base_url=LLM_URL,
            api_key=os.environ.get("VLLM_API_KEY", ""),
        )
        logger.info(f"✓ LLM configured: {LLM_MODEL}")
        return llm
    except Exception as e:
        logger.error(f"✗ Failed to create LLM: {e}")
        return None


async def create_stt() -> Optional[openai_plugin.STT]:
    """Create STT with error handling."""
    if not ENABLE_STT:
        logger.info("STT disabled by configuration")
        return None
    
    try:
        # Check service health first
        healthy = await check_service_health(f"{STT_URL}/health", "STT (Whisper)")
        if not healthy:
            logger.warning("STT service not healthy, continuing without speech recognition")
            return None
        
        stt = openai_plugin.STT(
            model="whisper-1",
            base_url=STT_URL,
            api_key=os.environ.get("WHISPER_API_KEY", ""),
        )
        logger.info("✓ STT configured")
        return stt
    except Exception as e:
        logger.error(f"✗ Failed to create STT: {e}")
        logger.warning("Continuing without speech recognition")
        return None


async def create_tts() -> Optional[openai_plugin.TTS]:
    """Create TTS with error handling."""
    if not ENABLE_TTS:
        logger.info("TTS disabled by configuration")
        return None
    
    try:
        # Check service health first
        healthy = await check_service_health(f"{TTS_URL}/v1/audio/voices", "TTS (Kokoro)")
        if not healthy:
            logger.warning("TTS service not healthy, continuing without speech synthesis")
            return None
        
        tts = openai_plugin.TTS(
            model="kokoro",
            voice=TTS_VOICE,
            base_url=TTS_URL,
            api_key=os.environ.get("KOKORO_API_KEY", ""),
        )
        logger.info(f"✓ TTS configured with voice: {TTS_VOICE}")
        return tts
    except Exception as e:
        logger.error(f"✗ Failed to create TTS: {e}")
        logger.warning("Continuing without speech synthesis")
        return None


async def entrypoint(ctx: JobContext):
    """
    Main entry point for the voice agent job.
    
    Includes:
    - Service health checks
    - Graceful degradation if services fail
    - Reconnection logic
    """
    logger.info(f"Voice agent connecting to room: {ctx.room.name}")
    
    # Health check phase
    logger.info("Performing service health checks...")
    # vLLM uses /v1/models for health check, not /health
    llm_healthy = await check_service_health(f"{LLM_URL}/v1/models", "LLM (vLLM)")
    
    if not llm_healthy:
        logger.error("LLM service not healthy - cannot start agent")
        raise RuntimeError("LLM service required but not available")
    
    # Create components with error handling
    llm = await create_llm()
    if not llm:
        raise RuntimeError("Failed to create LLM - agent cannot start")
    
    stt = await create_stt()
    tts = await create_tts()
    
    # Create VAD from prewarmed cache or load fresh
    try:
        vad = ctx.proc.userdata.get("vad") or silero.VAD.load()
        logger.info("✓ VAD loaded")
    except Exception as e:
        logger.error(f"✗ Failed to load VAD: {e}")
        logger.warning("Starting without voice activity detection")
        vad = None
    
    # Create session - only include working components
    session_kwargs = {"llm": llm}
    if stt:
        session_kwargs["stt"] = stt
    if tts:
        session_kwargs["tts"] = tts
    if vad:
        session_kwargs["vad"] = vad
    
    session = AgentSession(**session_kwargs)
    
    # Create agent
    agent = DreamVoiceAgent()
    
    # Setup graceful shutdown
    shutdown_event = asyncio.Event()
    
    def signal_handler(sig, frame):
        logger.info("Shutdown signal received")
        shutdown_event.set()
    
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    # Start session with retry logic
    max_retries = 3
    for attempt in range(max_retries):
        try:
            await session.start(agent=agent, room=ctx.room)
            logger.info("Voice agent session started")
            break
        except Exception as e:
            logger.error(f"Session start failed (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(1)
    
    # Connect to room with retry logic
    for attempt in range(max_retries):
        try:
            await ctx.connect()
            logger.info("Connected to room")
            break
        except Exception as e:
            logger.error(f"Room connection failed (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(1)
    
    # Wait for shutdown signal
    try:
        await shutdown_event.wait()
    except asyncio.CancelledError:
        logger.info("Agent task cancelled")
    finally:
        logger.info("Shutting down voice agent...")
        try:
            await session.close()
        except Exception as e:
            logger.error(f"Error during shutdown: {e}")


def prewarm(proc: JobProcess):
    """Prewarm function - load models before first job."""
    logger.info("Prewarming voice agent...")
    try:
        proc.userdata["vad"] = silero.VAD.load()
        logger.info("✓ VAD model loaded")
    except Exception as e:
        logger.error(f"✗ Failed to load VAD: {e}")
        proc.userdata["vad"] = None


if __name__ == "__main__":
    agent_port = int(os.getenv("AGENT_PORT", "8181"))
    
    # Log startup info
    logger.info("=" * 60)
    logger.info("Dream Server Voice Agent Starting")
    logger.info(f"Port: {agent_port}")
    logger.info(f"LLM: {LLM_URL}")
    logger.info(f"STT: {STT_URL} (enabled: {ENABLE_STT})")
    logger.info(f"TTS: {TTS_URL} (enabled: {ENABLE_TTS})")
    logger.info(f"Interruptions: {ENABLE_INTERRUPTIONS}")
    logger.info("=" * 60)
    
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            port=agent_port,
        )
    )
