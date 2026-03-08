#!/usr/bin/env python3
"""
LiveKit Concurrent Voice Session Stress Test
Tests WebRTC voice chat with multiple simultaneous sessions.

Measures:
- Connection establishment latency
- Audio round-trip latency (audio in → AI response → audio out)
- Session stability under concurrent load
- Error rates and failure modes

Usage:
    python livekit-concurrent-test.py --sessions 1,2,5,10 --duration 60
    python livekit-concurrent-test.py --sessions 5 --duration 120 --output results.json
"""

import argparse
import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional
import statistics

# LiveKit SDK imports
try:
    from livekit import rtc, api
    from livekit.rtc import Room, RoomOptions, VideoPresets
    LIVEKIT_AVAILABLE = True
except ImportError:
    LIVEKIT_AVAILABLE = False
    print("Warning: livekit SDK not installed. Install with: pip install livekit")

# Configuration - require environment variables (no defaults for security)
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
    raise ValueError(
        "LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables must be set.\n"
        "Example: LIVEKIT_API_KEY=your_key LIVEKIT_API_SECRET=your_secret python livekit-concurrent-test.py"
    )

# Test audio: 1 second of speech-like audio at 16kHz mono
SAMPLE_RATE = 16000
CHANNELS = 1
TEST_PHRASE = "Hello, this is a test message for latency measurement."

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("livekit-stress-test")


@dataclass
class LatencyMeasurement:
    """Single latency measurement"""
    session_id: str
    audio_send_time: float
    first_response_time: Optional[float] = None
    response_complete_time: Optional[float] = None
    error: Optional[str] = None
    
    @property
    def first_byte_latency_ms(self) -> Optional[float]:
        if self.first_response_time and self.audio_send_time:
            return (self.first_response_time - self.audio_send_time) * 1000
        return None
    
    @property
    def total_latency_ms(self) -> Optional[float]:
        if self.response_complete_time and self.audio_send_time:
            return (self.response_complete_time - self.audio_send_time) * 1000
        return None


@dataclass
class SessionMetrics:
    """Metrics for a single test session"""
    session_id: str
    room_name: str
    connect_start: float = 0
    connect_end: float = 0
    measurements: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    audio_packets_sent: int = 0
    audio_packets_received: int = 0
    connected: bool = False
    
    @property
    def connect_latency_ms(self) -> float:
        return (self.connect_end - self.connect_start) * 1000
    
    def add_measurement(self, m: LatencyMeasurement):
        self.measurements.append(m)
    
    def add_error(self, error: str):
        self.errors.append({"time": time.time(), "error": error})


@dataclass
class TestRun:
    """Results from a complete test run"""
    concurrent_sessions: int
    duration_seconds: int
    start_time: str
    end_time: str = ""
    sessions: list = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            "concurrent_sessions": self.concurrent_sessions,
            "duration_seconds": self.duration_seconds,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "sessions": [asdict(s) for s in self.sessions],
            "summary": self.summary()
        }
    
    def summary(self) -> dict:
        """Generate summary statistics"""
        all_connect_latencies = [s.connect_latency_ms for s in self.sessions if s.connected]
        all_first_byte = []
        all_total = []
        total_errors = 0
        
        for session in self.sessions:
            total_errors += len(session.errors)
            for m in session.measurements:
                if m.first_byte_latency_ms:
                    all_first_byte.append(m.first_byte_latency_ms)
                if m.total_latency_ms:
                    all_total.append(m.total_latency_ms)
        
        return {
            "total_sessions": len(self.sessions),
            "successful_connections": len(all_connect_latencies),
            "failed_connections": len(self.sessions) - len(all_connect_latencies),
            "total_errors": total_errors,
            "connect_latency_ms": self._stats(all_connect_latencies),
            "first_byte_latency_ms": self._stats(all_first_byte),
            "total_round_trip_ms": self._stats(all_total),
            "measurements_count": len(all_first_byte),
        }
    
    @staticmethod
    def _stats(values: list) -> dict:
        if not values:
            return {"min": None, "max": None, "mean": None, "median": None, "p95": None, "p99": None}
        sorted_vals = sorted(values)
        return {
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "mean": round(statistics.mean(values), 2),
            "median": round(statistics.median(values), 2),
            "p95": round(sorted_vals[int(len(sorted_vals) * 0.95)] if len(sorted_vals) >= 20 else max(values), 2),
            "p99": round(sorted_vals[int(len(sorted_vals) * 0.99)] if len(sorted_vals) >= 100 else max(values), 2),
        }


def generate_test_audio() -> bytes:
    """Generate synthetic test audio (sine wave + noise to simulate speech)"""
    import math
    import struct
    
    duration = 1.0  # 1 second
    samples = int(SAMPLE_RATE * duration)
    audio_data = []
    
    for i in range(samples):
        # Mix of frequencies to simulate speech-like audio
        t = i / SAMPLE_RATE
        sample = 0.3 * math.sin(2 * math.pi * 200 * t)  # Fundamental
        sample += 0.2 * math.sin(2 * math.pi * 400 * t)  # Harmonic
        sample += 0.1 * math.sin(2 * math.pi * 800 * t)  # Higher harmonic
        # Add some "noise" variation
        sample += 0.05 * math.sin(2 * math.pi * (100 + (i % 50)) * t)
        
        # Convert to 16-bit PCM
        sample = max(-1.0, min(1.0, sample))
        audio_data.append(int(sample * 32767))
    
    return struct.pack(f'{len(audio_data)}h', *audio_data)


class VoiceSessionSimulator:
    """Simulates a voice chat session with the LiveKit agent"""
    
    def __init__(self, session_id: str, room_name: str):
        self.session_id = session_id
        self.room_name = room_name
        self.metrics = SessionMetrics(session_id=session_id, room_name=room_name)
        self.room: Optional[Room] = None
        self.test_audio = generate_test_audio()
        self._current_measurement: Optional[LatencyMeasurement] = None
        self._response_received = asyncio.Event()
        
    async def connect(self) -> bool:
        """Connect to LiveKit room"""
        if not LIVEKIT_AVAILABLE:
            self.metrics.add_error("LiveKit SDK not available")
            return False
            
        try:
            self.metrics.connect_start = time.time()
            
            # Generate access token
            token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
            token.with_identity(f"stress-test-{self.session_id}")
            token.with_name(f"StressTest-{self.session_id[:8]}")
            token.with_grants(api.VideoGrants(
                room_join=True,
                room=self.room_name,
            ))
            jwt_token = token.to_jwt()
            
            # Create and connect room
            self.room = Room()
            
            # Set up event handlers
            @self.room.on("track_subscribed")
            def on_track_subscribed(track, publication, participant):
                if track.kind == rtc.TrackKind.KIND_AUDIO:
                    self._handle_audio_track(track)
            
            @self.room.on("data_received")
            def on_data(data, participant, kind):
                logger.debug(f"[{self.session_id}] Data received: {len(data)} bytes")
            
            await self.room.connect(LIVEKIT_URL, jwt_token)
            
            self.metrics.connect_end = time.time()
            self.metrics.connected = True
            logger.info(f"[{self.session_id}] Connected to room {self.room_name} "
                       f"(latency: {self.metrics.connect_latency_ms:.0f}ms)")
            return True
            
        except Exception as e:
            self.metrics.connect_end = time.time()
            self.metrics.add_error(f"Connection failed: {str(e)}")
            logger.error(f"[{self.session_id}] Connection failed: {e}")
            return False
    
    def _handle_audio_track(self, track):
        """Handle incoming audio from the agent"""
        async def process_audio():
            async for frame in rtc.AudioStream(track):
                if self._current_measurement:
                    if self._current_measurement.first_response_time is None:
                        self._current_measurement.first_response_time = time.time()
                        logger.debug(f"[{self.session_id}] First audio response received")
                    self._current_measurement.response_complete_time = time.time()
                    self.metrics.audio_packets_received += 1
                    
                    # Signal response received after getting some audio
                    if self.metrics.audio_packets_received % 10 == 0:
                        self._response_received.set()
        
        asyncio.create_task(process_audio())
    
    async def send_test_audio(self) -> LatencyMeasurement:
        """Send test audio and measure response latency"""
        measurement = LatencyMeasurement(session_id=self.session_id, audio_send_time=time.time())
        self._current_measurement = measurement
        self._response_received.clear()
        
        try:
            if not self.room or not self.room.local_participant:
                measurement.error = "Not connected"
                return measurement
            
            # Create audio source and track
            source = rtc.AudioSource(SAMPLE_RATE, CHANNELS)
            track = rtc.LocalAudioTrack.create_audio_track("test-audio", source)
            
            # Publish the track
            options = rtc.TrackPublishOptions()
            options.source = rtc.TrackSource.SOURCE_MICROPHONE
            await self.room.local_participant.publish_track(track, options)
            
            # Send audio frames
            frame = rtc.AudioFrame(
                data=self.test_audio,
                sample_rate=SAMPLE_RATE,
                num_channels=CHANNELS,
                samples_per_channel=len(self.test_audio) // 2,  # 16-bit samples
            )
            await source.capture_frame(frame)
            self.metrics.audio_packets_sent += 1
            
            logger.debug(f"[{self.session_id}] Sent test audio")
            
            # Wait for response (with timeout)
            try:
                await asyncio.wait_for(self._response_received.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                measurement.error = "Response timeout"
                logger.warning(f"[{self.session_id}] Response timeout")
            
            # Unpublish
            await self.room.local_participant.unpublish_track(track.sid)
            
        except Exception as e:
            measurement.error = str(e)
            logger.error(f"[{self.session_id}] Send audio error: {e}")
        
        self._current_measurement = None
        self.metrics.add_measurement(measurement)
        return measurement
    
    async def disconnect(self):
        """Disconnect from room"""
        if self.room:
            await self.room.disconnect()
            logger.info(f"[{self.session_id}] Disconnected")


async def run_session(session_id: str, room_name: str, duration: int, 
                      measurement_interval: float = 5.0) -> SessionMetrics:
    """Run a single test session for the specified duration"""
    simulator = VoiceSessionSimulator(session_id, room_name)
    
    connected = await simulator.connect()
    if not connected:
        return simulator.metrics
    
    # Run measurements for the duration
    start_time = time.time()
    end_time = start_time + duration
    
    try:
        while time.time() < end_time:
            measurement = await simulator.send_test_audio()
            if measurement.first_byte_latency_ms:
                logger.info(f"[{session_id}] Latency: first_byte={measurement.first_byte_latency_ms:.0f}ms, "
                           f"total={measurement.total_latency_ms:.0f}ms")
            
            # Wait before next measurement
            await asyncio.sleep(measurement_interval)
    finally:
        await simulator.disconnect()
    
    return simulator.metrics


async def run_concurrent_test(num_sessions: int, duration: int) -> TestRun:
    """Run multiple concurrent voice sessions"""
    test_run = TestRun(
        concurrent_sessions=num_sessions,
        duration_seconds=duration,
        start_time=datetime.utcnow().isoformat() + "Z"
    )
    
    # Create unique room name for this test
    room_prefix = f"stress-test-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    logger.info(f"Starting test with {num_sessions} concurrent sessions for {duration}s")
    
    # Start all sessions concurrently
    tasks = []
    for i in range(num_sessions):
        session_id = str(uuid.uuid4())
        room_name = f"{room_prefix}-{i}"
        task = asyncio.create_task(run_session(session_id, room_name, duration))
        tasks.append(task)
    
    # Wait for all sessions to complete
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for result in results:
        if isinstance(result, Exception):
            logger.error(f"Session error: {result}")
        elif isinstance(result, SessionMetrics):
            test_run.sessions.append(result)
    
    test_run.end_time = datetime.utcnow().isoformat() + "Z"
    
    # Print summary
    summary = test_run.summary()
    logger.info(f"\n{'='*60}")
    logger.info(f"Test Complete: {num_sessions} sessions, {duration}s duration")
    logger.info(f"  Connections: {summary['successful_connections']}/{summary['total_sessions']} succeeded")
    logger.info(f"  Measurements: {summary['measurements_count']} total")
    if summary['connect_latency_ms']['mean']:
        logger.info(f"  Connect Latency: mean={summary['connect_latency_ms']['mean']:.0f}ms, "
                   f"p95={summary['connect_latency_ms']['p95']:.0f}ms")
    if summary['first_byte_latency_ms']['mean']:
        logger.info(f"  First Byte Latency: mean={summary['first_byte_latency_ms']['mean']:.0f}ms, "
                   f"p95={summary['first_byte_latency_ms']['p95']:.0f}ms")
    if summary['total_round_trip_ms']['mean']:
        logger.info(f"  Total Round Trip: mean={summary['total_round_trip_ms']['mean']:.0f}ms, "
                   f"p95={summary['total_round_trip_ms']['p95']:.0f}ms")
    logger.info(f"  Errors: {summary['total_errors']}")
    logger.info(f"{'='*60}\n")
    
    return test_run


async def main():
    parser = argparse.ArgumentParser(description="LiveKit Concurrent Voice Session Stress Test")
    parser.add_argument("--sessions", type=str, default="1,2,5,10",
                       help="Comma-separated list of concurrent session counts to test")
    parser.add_argument("--duration", type=int, default=60,
                       help="Duration of each test run in seconds")
    parser.add_argument("--output", type=str, default=None,
                       help="Output file for results (JSON)")
    parser.add_argument("--url", type=str, default=LIVEKIT_URL,
                       help="LiveKit server URL")
    parser.add_argument("--interval", type=float, default=5.0,
                       help="Interval between measurements in seconds")
    parser.add_argument("--verbose", "-v", action="store_true",
                       help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    global LIVEKIT_URL
    LIVEKIT_URL = args.url
    
    session_counts = [int(x.strip()) for x in args.sessions.split(",")]
    
    all_results = []
    
    for count in session_counts:
        logger.info(f"\n{'#'*60}")
        logger.info(f"# Testing with {count} concurrent sessions")
        logger.info(f"{'#'*60}\n")
        
        result = await run_concurrent_test(count, args.duration)
        all_results.append(result.to_dict())
        
        # Brief pause between test runs
        if count != session_counts[-1]:
            logger.info("Waiting 5s before next test run...")
            await asyncio.sleep(5)
    
    # Save results
    output_file = args.output or f"livekit-stress-results-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output_path = Path(output_file)
    
    with open(output_path, "w") as f:
        json.dump({
            "test_config": {
                "livekit_url": LIVEKIT_URL,
                "session_counts": session_counts,
                "duration_seconds": args.duration,
                "measurement_interval": args.interval,
            },
            "test_runs": all_results,
        }, f, indent=2, default=str)
    
    logger.info(f"Results saved to: {output_path}")
    print(f"\nResults saved to: {output_path}")
    print(f"Analyze with: python livekit-analyze-results.py {output_path}")


if __name__ == "__main__":
    if not LIVEKIT_AVAILABLE:
        print("Error: livekit SDK not installed")
        print("Install with: pip install livekit livekit-api")
        exit(1)
    
    asyncio.run(main())
