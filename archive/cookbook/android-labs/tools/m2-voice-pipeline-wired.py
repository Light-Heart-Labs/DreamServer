#!/usr/bin/env python3
"""
M2 Voice Pipeline - Wired Implementation
Real STT → LLM → TTS with cluster endpoints

Usage:
    python m2-voice-pipeline-wired.py [input.wav]
    
    Without args: interactive mode (mock input for testing)
    With audio file: process that file

Requirements:
    pip install openai kokoro soundfile faster-whisper numpy
    apt-get install espeak-ng  # Required for Kokoro
"""

import os
import sys
import time
from typing import Optional, Generator, Tuple
import numpy as np

# Configuration - uses cluster proxy endpoints
# naming matches the SDK's base_url parameter for clarity
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://192.168.0.122:9100/v1")
STT_BASE_URL = os.getenv("STT_BASE_URL", "http://192.168.0.122:9101/v1")
TTS_BASE_URL = os.getenv("TTS_BASE_URL", "http://192.168.0.122:9102/v1")
MODEL = os.getenv("MODEL", "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ")

# TTS settings
TTS_VOICE = os.getenv("TTS_VOICE", "af_heart")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.0"))
SAMPLE_RATE = 24000


class VoicePipeline:
    """
    Full voice pipeline: Audio → Text → LLM → Speech
    Uses local cluster for all inference.
    """
    
    def __init__(self, verbose: bool = True):
        self.verbose = verbose
        self._llm = None
        self._tts = None
        self._stt = None
        
    @property
    def llm(self):
        """Lazy load OpenAI client for vLLM"""
        if self._llm is None:
            from openai import OpenAI
            self._llm = OpenAI(base_url=VLLM_URL, api_key="dummy")
        return self._llm
    
    @property
    def tts(self):
        """Lazy load Kokoro TTS pipeline"""
        if self._tts is None:
            from kokoro import KPipeline
            self._tts = KPipeline(lang_code='a')  # American English
        return self._tts
    
    @property
    def stt(self):
        """Lazy load Whisper model"""
        if self._stt is None:
            from faster_whisper import WhisperModel
            self._stt = WhisperModel("small", device="cuda", compute_type="float16")
        return self._stt
    
    def log(self, stage: str, msg: str):
        """Conditional logging"""
        if self.verbose:
            print(f"[{stage}] {msg}")
    
    def transcribe_audio(self, audio_path: str) -> str:
        """
        Transcribe audio file using faster-whisper.
        
        Args:
            audio_path: Path to audio file (wav, mp3, etc.)
            
        Returns:
            Transcribed text
        """
        start = time.perf_counter()
        
        segments, info = self.stt.transcribe(audio_path, beam_size=5)
        text = " ".join([segment.text.strip() for segment in segments])
        
        elapsed = (time.perf_counter() - start) * 1000
        self.log("STT", f"{elapsed:.0f}ms | lang={info.language} | {text[:50]}...")
        
        return text
    
    def transcribe_bytes(self, audio_data: bytes, sample_rate: int = 16000) -> str:
        """
        Transcribe raw audio bytes.
        
        Args:
            audio_data: Raw PCM audio bytes
            sample_rate: Sample rate of input audio
            
        Returns:
            Transcribed text
        """
        import tempfile
        import soundfile as sf
        
        # Convert bytes to numpy array (assuming 16-bit PCM)
        audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
        
        # Write to temp file (faster-whisper needs file path)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            sf.write(f.name, audio_np, sample_rate)
            result = self.transcribe_audio(f.name)
            os.unlink(f.name)
            return result
    
    def generate_response(self, text: str, system_prompt: Optional[str] = None) -> str:
        """
        Generate LLM response using vLLM.
        
        Args:
            text: User input text
            system_prompt: Optional system prompt
            
        Returns:
            LLM response text
        """
        start = time.perf_counter()
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": text})
        
        response = self.llm.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=150,  # Keep short for voice
            temperature=0.7
        )
        
        result = response.choices[0].message.content
        elapsed = (time.perf_counter() - start) * 1000
        self.log("LLM", f"{elapsed:.0f}ms | {result[:50]}...")
        
        return result
    
    def synthesize_speech(self, text: str) -> np.ndarray:
        """
        Convert text to audio using Kokoro TTS.
        
        Args:
            text: Text to synthesize
            
        Returns:
            Audio as numpy array (24kHz)
        """
        start = time.perf_counter()
        
        audio_chunks = []
        for graphemes, phonemes, audio in self.tts(
            text, 
            voice=TTS_VOICE, 
            speed=TTS_SPEED,
            split_pattern=r'[.!?;]+\s*'  # Split on sentence boundaries
        ):
            audio_chunks.append(audio)
        
        result = np.concatenate(audio_chunks) if audio_chunks else np.array([])
        
        elapsed = (time.perf_counter() - start) * 1000
        duration = len(result) / SAMPLE_RATE
        self.log("TTS", f"{elapsed:.0f}ms | {duration:.1f}s audio | voice={TTS_VOICE}")
        
        return result
    
    def synthesize_speech_streaming(self, text: str) -> Generator[Tuple[str, np.ndarray], None, None]:
        """
        Stream TTS output chunk by chunk.
        
        Yields:
            (text_chunk, audio_chunk) tuples
        """
        for graphemes, phonemes, audio in self.tts(
            text,
            voice=TTS_VOICE,
            speed=TTS_SPEED,
            split_pattern=r'[.!?;]+\s*'
        ):
            yield (graphemes, audio)
    
    def process_audio(self, audio_path: str, output_path: str = "response.wav") -> str:
        """
        Full pipeline: audio file in → audio file out.
        
        Args:
            audio_path: Input audio file path
            output_path: Output audio file path
            
        Returns:
            LLM response text
        """
        import soundfile as sf
        
        total_start = time.perf_counter()
        
        # 1. Speech-to-Text
        user_text = self.transcribe_audio(audio_path)
        self.log("Pipeline", f"User: {user_text}")
        
        # 2. LLM Response
        response_text = self.generate_response(user_text)
        self.log("Pipeline", f"Assistant: {response_text}")
        
        # 3. Text-to-Speech
        audio = self.synthesize_speech(response_text)
        sf.write(output_path, audio, SAMPLE_RATE)
        
        total_elapsed = (time.perf_counter() - total_start) * 1000
        self.log("Pipeline", f"Total: {total_elapsed:.0f}ms | Saved: {output_path}")
        
        return response_text
    
    def process_text(self, text: str, output_path: str = "response.wav") -> str:
        """
        Text-only pipeline (skip STT): text → LLM → audio.
        
        Useful for testing without audio input.
        """
        import soundfile as sf
        
        total_start = time.perf_counter()
        
        # 1. LLM Response
        response_text = self.generate_response(text)
        self.log("Pipeline", f"User: {text}")
        self.log("Pipeline", f"Assistant: {response_text}")
        
        # 2. Text-to-Speech
        audio = self.synthesize_speech(response_text)
        sf.write(output_path, audio, SAMPLE_RATE)
        
        total_elapsed = (time.perf_counter() - total_start) * 1000
        self.log("Pipeline", f"Total: {total_elapsed:.0f}ms | Saved: {output_path}")
        
        return response_text


def main():
    """CLI entry point"""
    print("=== M2 Voice Pipeline (Wired) ===")
    print(f"vLLM:    {VLLM_URL}")
    print(f"Model:   {MODEL}")
    print(f"Voice:   {TTS_VOICE}")
    print()
    
    pipeline = VoicePipeline(verbose=True)
    
    if len(sys.argv) > 1:
        # Process input file
        input_path = sys.argv[1]
        output_path = sys.argv[2] if len(sys.argv) > 2 else "response.wav"
        
        if not os.path.exists(input_path):
            print(f"Error: File not found: {input_path}")
            sys.exit(1)
            
        pipeline.process_audio(input_path, output_path)
    else:
        # Demo mode - test with text input
        print("Demo mode (no audio input)")
        print("-" * 40)
        
        test_prompts = [
            "Hello, how are you today?",
            "What's the weather like?",
            "Tell me a short joke.",
        ]
        
        for prompt in test_prompts:
            print(f"\nTesting: {prompt}")
            try:
                pipeline.process_text(prompt, f"test_{test_prompts.index(prompt)}.wav")
            except Exception as e:
                print(f"Error: {e}")
                continue


if __name__ == "__main__":
    main()
