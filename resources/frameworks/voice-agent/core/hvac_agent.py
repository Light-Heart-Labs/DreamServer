"""
HVAC Grace Multi-Agent Voice System
Portal agent routes callers to specialized department agents.
With full transcript capture, audio recording, and shared caller state.

Run with: python hvac_agent.py start
"""

from dataclasses import dataclass, field
from datetime import datetime
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import AgentServer, AgentSession, Agent, room_io, stt, function_tool
from livekit.plugins import noise_cancellation, silero, openai
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from prompts import (
    PORTAL_INSTRUCTION,
    SERVICE_INSTRUCTION,
    PARTS_INSTRUCTION,
    BILLING_INSTRUCTION,
    PROJECTS_INSTRUCTION,
    MAINTENANCE_INSTRUCTION,
    CONTROLS_INSTRUCTION,
    OFFICE_INSTRUCTION,
    CLOSING_SEQUENCE,
    CLOSING_INSTRUCTION,
)
from tts_filter import FilteredTTS
import requests
import struct
import wave
import io
import json
import asyncio
import aiohttp
import os
import re
from pathlib import Path
from typing import Optional, List

load_dotenv(Path(__file__).parent.parent / "config" / ".env", override=False)

# HVAC-specific n8n webhook endpoint
N8N_INTAKE_URL = os.getenv("N8N_INTAKE_URL", "http://localhost:5679/webhook/ticket")

# Shared LLM endpoint
# naming matches the SDK's base_url parameter for clarity
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:8080/v1")

# Company name for consistent messaging
COMPANY_NAME = os.getenv("COMPANY_NAME", "Light Heart Mechanical")

# Recordings directory
RECORDINGS_DIR = Path(os.getenv("RECORDINGS_DIR", "./recordings"))
RECORDINGS_DIR.mkdir(exist_ok=True)


@dataclass
class CallData:
    """Shared state that persists across all agent handoffs"""
    # Call identification
    room_name: str = ""
    call_start: datetime = field(default_factory=datetime.now)

    # Caller info (carried between specialists)
    caller_name: str = ""
    caller_phone: str = ""
    caller_company: str = ""
    caller_site: str = ""
    caller_role: str = ""

    # Transcript (captured in real-time)
    transcript_lines: List[str] = field(default_factory=list)

    # Department tracking
    current_department: str = "portal"
    departments_visited: List[str] = field(default_factory=list)

    # Audio recording
    audio_frames: List[bytes] = field(default_factory=list)
    sample_rate: int = 48000

    # NEW: Handoff context fields
    initial_request: str = ""        # What caller said that triggered routing
    routing_reason: str = ""         # Why we routed (intent detected)
    last_grace_statement: str = ""   # What Grace said before handoff
    handoff_context_summary: str = "" # Brief summary for specialist

    def add_transcript_line(self, speaker: str, text: str):
        """Add a line to the transcript with timestamp"""
        if text and text.strip():
            timestamp = datetime.now().strftime("%H:%M:%S")
            line = f"[{timestamp}] {speaker}: {text.strip()}"
            self.transcript_lines.append(line)
            print(f"TRANSCRIPT: {line}")

    def switch_department(self, new_department: str):
        """Track department changes"""
        if self.current_department != new_department:
            if self.current_department not in self.departments_visited:
                self.departments_visited.append(self.current_department)
            self.current_department = new_department
            print(f"DEPARTMENT SWITCH: {self.departments_visited[-1] if self.departments_visited else 'start'} -> {new_department}")

    def get_full_transcript(self) -> str:
        """Get the complete transcript as a string"""
        return "\n".join(self.transcript_lines)

    def get_caller_context(self) -> str:
        """Get known caller info for specialist prompts"""
        parts = []
        if self.caller_name:
            parts.append(f"Caller name: {self.caller_name}")
        if self.caller_phone:
            parts.append(f"Callback number: {self.caller_phone}")
        if self.caller_company:
            parts.append(f"Company: {self.caller_company}")
        if self.caller_site:
            parts.append(f"Site: {self.caller_site}")
        return "\n".join(parts) if parts else "No caller info collected yet."

    def set_handoff_context(self, caller_statement: str, intent: str, grace_response: str = ""):
        """Capture full context for seamless handoff."""
        self.initial_request = caller_statement
        self.routing_reason = intent
        self.last_grace_statement = grace_response
        self.handoff_context_summary = f"Caller needs help with {intent}: {caller_statement[:100]}"


# Global call data - persists for the entire call
_current_call_data: Optional[CallData] = None


# Intent detection keywords
INTENT_KEYWORDS = {
    "service": [
        "broken", "down", "not working", "no heat", "no cooling", "not cooling",
        "no ac", "no air", "ac is", "a/c", "air conditioning",
        "emergency", "service call", "technician", "repair", "leak", "leaking",
        "alarm", "beeping", "noise", "loud", "smell", "burning", "frozen",
        "hot", "cold", "uncomfortable", "comfort", "temperature"
    ],
    "parts": [
        "part", "parts", "waiting on", "eta", "order status", "when will",
        "compressor", "motor", "fan", "belt", "filter", "coil", "valve",
        "shipped", "shipping", "delivery", "back order", "backordered"
    ],
    "billing": [
        "invoice", "invoices", "bill", "billing", "payment", "pay",
        "charge", "charges", "account", "balance", "statement",
        "credit", "refund", "dispute", "accounts payable", "ap", "ar"
    ],
    "projects": [
        "quote", "quotes", "bid", "bids", "project", "projects",
        "install", "installation", "replace", "replacement", "new system", "new unit",
        "proposal", "estimate", "itb", "rfp", "scope"
    ],
    "maintenance": [
        "pm", "preventive", "maintenance", "contract", "agreement",
        "scheduled", "schedule", "next visit", "quarterly", "annual",
        "inspection", "tune-up", "tune up"
    ],
    "controls": [
        "bas", "building automation", "ddc", "controls", "niagara", "tridium",
        "honeywell", "johnson controls", "jci", "bacnet", "programming",
        "remote access", "thermostat", "setpoint", "schedule"
    ],
    "general": [
        "coi", "certificate of insurance", "insurance certificate", "proof of insurance",
        "feedback", "complaint", "complain", "suggestion",
        "salesperson", "sales call", "vendor", "sales rep",
        "speak to someone", "talk to someone", "speak with",
        "general question", "general inquiry", "not sure who",
        "other", "something else", "different department"
    ],
}

# Keywords indicating caller is done (triggers closing agent)
CLOSING_KEYWORDS = [
    "no", "nope", "that's it", "that's all", "i'm good", "im good",
    "nothing else", "no thanks", "no thank you", "all set", "that is all",
    "that is it", "that'll do", "that will do", "i think that's it",
    "we're good", "we are good", "done", "finished"
]


# Extraction prompt for converting conversations to structured ticket data
EXTRACTION_PROMPT = """Extract dispatch info from this commercial HVAC call.

IMPORTANT: If the caller discussed MULTIPLE separate issues (e.g., invoice question AND parts status), create a SEPARATE ticket for EACH issue.

CATEGORIZE by who handles it:
- "service" - Equipment down, repairs, emergencies, comfort complaints, alarms
- "maintenance" - PM scheduling, contract questions, when is my next visit
- "projects" - Bids, quotes, new installs, replacements, ITB responses, project status
- "controls" - BAS issues, building automation, DDC, programming, remote access problems
- "billing" - Invoice questions, disputes, payment status, AP (vendor invoices), AR
- "parts" - Part order status, ETA, availability questions
- "general" - Feedback, complaints, salespeople, vendor calls, general inquiries

Return a JSON array of tickets (even if just one):
[
  {
    "category": "service|maintenance|projects|controls|billing|parts|general",
    "caller_name": "",
    "caller_phone": "",
    "caller_company": "",
    "caller_role": "",
    "site_name": "",
    "urgency": "emergency|urgent|normal|low",
    "is_emergency": false,
    "equipment_type": "",
    "equipment_location": "",
    "issue_brief": "",
    "requested_tech": "",
    "summary": "",
    "details": {}
  }
]

RULES:
- Create ONE ticket per distinct issue/request
- "emergency" = caller confirmed OK with after-hours/OT rates, needs someone today/tonight
- "urgent" = needs attention today but normal hours OK
- "normal" = standard priority, tomorrow is fine
- site_name is PRIMARY identifier (more important than address)
- summary should be dispatch-ready, 1-2 sentences max
- Don't invent info that wasn't provided
- Copy caller_name, caller_phone, caller_company, site_name to ALL tickets
- For billing, include invoice_number or po_number in details if mentioned
- For projects, include deadline in details if mentioned
- For parts, include part_description and original_ticket in details if mentioned

TRANSCRIPT:
{transcript}

Return ONLY the JSON array."""


def detect_intent(text: str) -> str:
    """Detect caller intent from their statement for routing.

    CRITICAL: Operational/safety issues ALWAYS take priority over admin issues.
    If caller mentions equipment problems AND admin stuff, route to service first.
    """
    text_lower = text.lower()

    # URGENCY KEYWORDS - these indicate operational issues that take priority
    urgency_keywords = {
        'down', 'broken', 'not working', 'emergency', 'tripping', 'failed',
        'no heat', 'no cooling', 'no ac', 'leaking', 'flooding', 'alarm',
        'affecting production', 'impacting', 'urgent', 'asap', 'today',
        'overnight', 'stopped', 'won\'t start', 'making noise', 'smoking'
    }

    # Check for urgency indicators first
    has_urgency = any(kw in text_lower for kw in urgency_keywords)

    intent_scores = {}
    for intent, keywords in INTENT_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            # Boost service/controls scores if urgency detected
            if has_urgency and intent in ('service', 'controls'):
                score += 10  # Heavy boost for operational intents with urgency
            intent_scores[intent] = score

    if intent_scores:
        # If both service and admin intents detected with urgency, force service
        if has_urgency and 'service' in intent_scores:
            return 'service'
        if has_urgency and 'controls' in intent_scores:
            return 'controls'
        return max(intent_scores, key=intent_scores.get)
    return "general"


def is_caller_done(text: str) -> bool:
    """Check if caller is indicating they're done/finished"""
    text_lower = text.lower().strip()

    # Check for exact matches or close matches
    for keyword in CLOSING_KEYWORDS:
        if keyword in text_lower:
            # Make sure it's not a false positive like "no, I need..."
            # by checking if there's more substantial content after
            after_keyword = text_lower.split(keyword, 1)[-1].strip()
            # If there's significant content after, it's probably not a closing
            if len(after_keyword) > 20:
                continue
            return True
    return False


def build_conversation_context(call_data) -> str:
    """Build the conversation context for seamless continuation."""
    parts = []
    
    # Recent transcript (last 20 lines to manage tokens)
    if hasattr(call_data, 'transcript_lines') and call_data.transcript_lines:
        recent = call_data.transcript_lines[-20:]
        transcript_text = "\n".join(recent)
        parts.append(f'''
# CONVERSATION SO FAR
{transcript_text}
''')
    
    # Handoff context
    if hasattr(call_data, 'initial_request') and call_data.initial_request:
        parts.append(f'''
# WHAT THE CALLER NEEDS
The caller said: "{call_data.initial_request}"
This is why you're helping them now. Acknowledge and continue - do NOT ask them to repeat.
''')
    
    
    return "\n".join(parts)


def get_specialist_instruction(intent: str, call_data: CallData) -> str:
    """Get the appropriate specialist instruction with caller context"""
    base_instructions = {
        "service": SERVICE_INSTRUCTION,
        "parts": PARTS_INSTRUCTION,
        "billing": BILLING_INSTRUCTION,
        "projects": PROJECTS_INSTRUCTION,
        "maintenance": MAINTENANCE_INSTRUCTION,
        "controls": CONTROLS_INSTRUCTION,
        "general": OFFICE_INSTRUCTION,
    }

    base = base_instructions.get(intent, OFFICE_INSTRUCTION)

    # Add caller context if we have any info
    caller_context = call_data.get_caller_context()
    if caller_context != "No caller info collected yet.":
        context_section = f"""

# KNOWN CALLER INFORMATION
The following information has already been collected. DO NOT ask for this again.
{caller_context}

Use this information to personalize your greeting (e.g., "Hi [name], I see you're calling about [site]...")
Skip any intake questions for information you already have.
"""
        base = base + context_section

    # Add conversation context for seamless handoff
    conversation_context = build_conversation_context(call_data)
    base = base + conversation_context

    return base + CLOSING_SEQUENCE


def get_department_name(intent: str) -> str:
    """Get human-readable department name"""
    names = {
        "service": "service team",
        "parts": "parts team",
        "billing": "billing team",
        "projects": "projects team",
        "maintenance": "maintenance team",
        "controls": "controls team",
        "general": "office team",
    }
    return names.get(intent, "office team")


def extract_caller_info_from_text(text: str, call_data: CallData):
    """Try to extract caller info from their speech - conservative extraction only"""
    text_lower = text.lower()

    # Common words that are NOT names - avoid false positives
    not_names = {
        'a', 'an', 'the', 'this', 'that', 'here', 'there', 'just', 'only',
        'quick', 'small', 'big', 'good', 'bad', 'new', 'old', 'first', 'last',
        'going', 'trying', 'calling', 'looking', 'wondering', 'thinking',
        'having', 'getting', 'making', 'taking', 'doing', 'being',
        'my', 'your', 'his', 'her', 'our', 'their', 'its',
        'yeah', 'yes', 'no', 'not', 'sure', 'okay', 'ok', 'right',
        'actually', 'basically', 'really', 'definitely', 'probably',
        'about', 'around', 'after', 'before', 'over', 'under',
        'ready', 'sure', 'glad', 'happy', 'able', 'sorry',
    }

    if not call_data.caller_name:
        # Pattern 1: "my name is X"
        name_match = re.search(r"my name is ([a-z]+(?:\s+[a-z]+)?)", text_lower)

        # Pattern 2: "this is X from Y" - common business intro
        if not name_match:
            name_match = re.search(r"this is ([a-z]+(?:\s+[a-z]+)?)\s+from\s+", text_lower)

        # Pattern 3: "it's X" when asked for name (short response)
        if not name_match:
            name_match = re.search(r"^(?:it's|its|it is)\s+([a-z]+(?:\s+[a-z]+)?)\s*[,.]?$", text_lower.strip())

        # Pattern 4: "I'm X" / "I am X"
        if not name_match:
            name_match = re.search(r"(?:i'm|i am)\s+([a-z]+(?:\s+[a-z]+)?)", text_lower)

        # Pattern 5: "X here" (e.g., "John here")
        if not name_match:
            name_match = re.search(r"^([a-z]+(?:\s+[a-z]+)?)\s+here", text_lower.strip())

        # Pattern 6: "X calling from Y"
        if not name_match:
            name_match = re.search(r"^([a-z]+(?:\s+[a-z]+)?)\s+calling\s+from\s+", text_lower.strip())

        if name_match:
            potential_name = name_match.group(1)
            first_word = potential_name.split()[0]
            # Only accept if first word looks like a name (not a common word)
            if first_word not in not_names and len(first_word) >= 2:
                call_data.caller_name = potential_name.title()
                print(f"EXTRACTED NAME: {call_data.caller_name}")

    # Company extraction - "from [Company]"
    if not call_data.caller_company:
        company_match = re.search(r"from\s+([a-z][a-z\s]+?)(?:\.|,|$|\s+(?:you|we|i|and|the|at|on))", text_lower)
        if company_match:
            potential_company = company_match.group(1).strip()
            if len(potential_company) >= 3 and potential_company not in not_names:
                call_data.caller_company = potential_company.title()
                print(f"EXTRACTED COMPANY: {call_data.caller_company}")

    # Phone number extraction - this is reliable
    phone_pattern = r'\b(\d{3}[-.\s]\d{3}[-.\s]\d{4})\b'
    phone_match = re.search(phone_pattern, text)
    if phone_match and not call_data.caller_phone:
        call_data.caller_phone = phone_match.group(1)
        print(f"EXTRACTED PHONE: {call_data.caller_phone}")


async def save_audio_recording(call_data: CallData) -> Optional[str]:
    """Save the recorded audio frames to a WAV file"""
    if not call_data.audio_frames:
        print("No audio frames to save")
        return None

    try:
        filename = f"{call_data.room_name}_{call_data.call_start.strftime('%Y%m%d_%H%M%S')}.wav"
        filepath = RECORDINGS_DIR / filename

        # Combine all audio frames
        audio_data = b''.join(call_data.audio_frames)

        # Write WAV file
        with wave.open(str(filepath), 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(call_data.sample_rate)
            wav_file.writeframes(audio_data)

        print(f"Audio saved: {filepath} ({len(audio_data)} bytes)")
        return str(filepath)
    except Exception as e:
        print(f"Failed to save audio: {e}")
        return None


async def transcribe_audio_file(filepath: str) -> Optional[str]:
    """Send audio file to Whisper for transcription"""
    try:
        with open(filepath, 'rb') as f:
            audio_data = f.read()

        resp = requests.post(
            os.getenv("STT_BASE_URL", "http://localhost:9000/v1") + "/audio/transcriptions",
            files={"file": (os.path.basename(filepath), audio_data, "audio/wav")},
            data={"model": os.getenv("STT_MODEL", "Systran/faster-whisper-large-v3")},
            timeout=300  # 5 minutes for long recordings
        )
        resp.raise_for_status()
        result = resp.json()
        return result.get("text", "")
    except Exception as e:
        print(f"Audio transcription failed: {e}")
        return None


async def extract_ticket_data(transcript: str) -> dict:
    """Send transcript to LLM for structured extraction"""
    prompt = EXTRACTION_PROMPT.replace("{transcript}", transcript)

    payload = {
        "model": os.getenv("LLM_MODEL", "Qwen/Qwen2.5-32B-Instruct-AWQ"),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 1500
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(LLM_BASE_URL, json=payload, timeout=30) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"]

                    # Parse JSON from response
                    content = content.strip()
                    if content.startswith("```json"):
                        content = content[7:]
                    if content.startswith("```"):
                        content = content[3:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()

                    return json.loads(content)
                else:
                    print(f"Extraction API error: {resp.status}")
                    return None
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        return None
    except Exception as e:
        print(f"Extraction failed: {e}")
        return None


async def post_master_call_record(call_data: CallData, audio_path: Optional[str]) -> Optional[str]:
    """Post the master call record to n8n"""
    call_end = datetime.now()
    duration = (call_end - call_data.call_start).total_seconds()

    record = {
        "type": "call_record",
        "call_id": call_data.room_name,
        "timestamp": call_data.call_start.isoformat(),
        "duration_seconds": int(duration),
        "audio_file_path": audio_path or "",
        "full_transcript": call_data.get_full_transcript(),
        "caller_name": call_data.caller_name,
        "caller_phone": call_data.caller_phone,
        "caller_company": call_data.caller_company,
        "caller_site": call_data.caller_site,
        "departments_visited": call_data.departments_visited + [call_data.current_department],
    }

    try:
        async with aiohttp.ClientSession() as session:
            # Post to a separate call_records endpoint
            url = N8N_INTAKE_URL.replace("/ticket", "/call_record")
            async with session.post(url, json=record, timeout=10) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    print(f"Master call record posted: {result.get('id')}")
                    return result.get('id')
                else:
                    print(f"Call record post failed: {resp.status}")
                    return None
    except Exception as e:
        print(f"Failed to post call record: {e}")
        return None


async def post_to_n8n(ticket_data: dict, transcript: str, master_record_id: Optional[str] = None) -> bool:
    """Post extracted ticket data to HVAC n8n webhook"""
    # Map urgency to numeric priority (1=highest, 4=lowest)
    urgency_to_priority = {
        'emergency': 1,
        'urgent': 2,
        'normal': 3,
        'low': 4
    }
    ticket_data['priority'] = urgency_to_priority.get(ticket_data.get('urgency', 'normal'), 3)
    ticket_data["transcript"] = transcript
    if master_record_id:
        ticket_data["master_call_record_id"] = master_record_id

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                N8N_INTAKE_URL,
                json=ticket_data,
                headers={"Content-Type": "application/json"},
                timeout=10
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    print(f"Ticket posted: ID {result.get('id')}, Category: {result.get('category')}")
                    return True
                else:
                    print(f"n8n webhook error: {resp.status}")
                    return False
    except Exception as e:
        print(f"Failed to post to n8n: {e}")
        return False


async def process_call_end(call_data: CallData):
    """Process the call after it ends - create master record and tickets"""
    print("\n" + "="*60)
    print("PROCESSING CALL END")
    print("="*60)

    # Get the real-time captured transcript
    transcript = call_data.get_full_transcript()

    if not transcript or len(call_data.transcript_lines) < 3:
        print("Call too short, skipping ticket submission")
        return

    print(f"Transcript has {len(call_data.transcript_lines)} lines")
    print(f"Departments visited: {call_data.departments_visited + [call_data.current_department]}")

    # Save audio recording (if we have frames)
    audio_path = await save_audio_recording(call_data)

    # Whisper transcription of audio file (for archival, one-sided audio only)
    if audio_path:
        whisper_transcript = await transcribe_audio_file(audio_path)
        if whisper_transcript:
            print(f"Whisper audio transcript ({len(whisper_transcript)} chars) archived")

    # Post master call record first
    master_id = await post_master_call_record(call_data, audio_path)

    # Always use real-time transcript for extraction (has both sides of conversation)
    extraction_result = await extract_ticket_data(transcript)

    if extraction_result:
        # Handle both single ticket (dict) and multiple tickets (list)
        tickets = extraction_result if isinstance(extraction_result, list) else [extraction_result]

        print(f"Extracted {len(tickets)} ticket(s)")

        for i, ticket_data in enumerate(tickets):
            # Add known caller info to each ticket
            if call_data.caller_name:
                ticket_data["caller_name"] = call_data.caller_name
            if call_data.caller_phone:
                ticket_data["caller_phone"] = call_data.caller_phone
            if call_data.caller_company:
                ticket_data["caller_company"] = call_data.caller_company
            if call_data.caller_site:
                ticket_data["site_name"] = call_data.caller_site

            success = await post_to_n8n(ticket_data, transcript, master_id)
            if success:
                print(f"Ticket {i+1}/{len(tickets)} created - Category: {ticket_data.get('category')}")
            else:
                print(f"Ticket {i+1}/{len(tickets)} failed to create")
    else:
        print("Failed to extract ticket data")

    print("="*60 + "\n")


class PortalAgent(Agent):
    """Initial triage agent - routes callers to specialists"""
    def __init__(self) -> None:
        super().__init__(instructions=PORTAL_INSTRUCTION)


class ServiceAgent(Agent):
    """Service/dispatch specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("service", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class PartsAgent(Agent):
    """Parts status specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("parts", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class BillingAgent(Agent):
    """Billing/AR/AP specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("billing", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class ProjectsAgent(Agent):
    """Projects/bids/quotes specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("projects", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class MaintenanceAgent(Agent):
    """Maintenance/PM/contracts specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("maintenance", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class ControlsAgent(Agent):
    """Controls/BAS specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("controls", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class GeneralAgent(Agent):
    """General/catch-all specialist"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=get_specialist_instruction("general", call_data),
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        # Let the LLM continue naturally based on injected context
        # No hardcoded speech - the prompt tells LLM to acknowledge and continue
        pass

class ClosingAgent(Agent):
    """Closing agent - recaps tickets and wraps up call"""
    def __init__(self, call_data: CallData, tools: list = None) -> None:
        super().__init__(
            instructions=CLOSING_INSTRUCTION,
            tools=tools or []
        )
        self._call_data = call_data

    async def on_enter(self) -> None:
        """Recap tickets when entering closing agent"""
        recap_parts = []

        if self._call_data and self._call_data.departments_visited:
            for dept in self._call_data.departments_visited:
                if dept == "maintenance":
                    recap_parts.append("your maintenance agreement concern")
                elif dept == "billing":
                    recap_parts.append("your invoice question")
                elif dept == "service":
                    recap_parts.append("your service request")
                elif dept == "parts":
                    recap_parts.append("your parts inquiry")
                elif dept == "projects":
                    recap_parts.append("your project question")
                elif dept == "controls":
                    recap_parts.append("your controls issue")

        # Also check current department if not already in visited
        current = self._call_data.current_department if self._call_data else None
        if current and current not in (self._call_data.departments_visited if self._call_data else []):
            if current == "maintenance":
                recap_parts.append("your maintenance agreement concern")
            elif current == "billing":
                recap_parts.append("your invoice question")
            elif current == "service":
                recap_parts.append("your service request")
            elif current == "parts":
                recap_parts.append("your parts inquiry")
            elif current == "projects":
                recap_parts.append("your project question")
            elif current == "controls":
                recap_parts.append("your controls issue")

        if recap_parts:
            if len(recap_parts) == 1:
                recap = f"I have created a ticket for {recap_parts[0]}."
            elif len(recap_parts) == 2:
                recap = f"I have created tickets for {recap_parts[0]} and {recap_parts[1]}."
            else:
                recap = f"I have created tickets for {', '.join(recap_parts[:-1])}, and {recap_parts[-1]}."
            message = f"{recap} These are in our system and prioritized by urgency. You can expect a callback soon."
        else:
            message = "Your ticket is in our system and prioritized by urgency. You can expect a callback soon."

        self.session.say(message, allow_interruptions=True)


# =========================================================================
# ROUTING FUNCTION TOOLS
# These allow specialists to route to other agents
# =========================================================================

def create_routing_tools(call_data: CallData):
    """Create routing tools that have access to call_data.

    The tools list is built first, then each tool closure references it.
    This allows agents to pass tools to subsequent agents during handoffs.
    """
    # We'll store tools here so closures can reference them
    tools_container = []

    @function_tool()
    async def route_to_closing():
        """Route to closing agent when caller is done. Call this when the caller says no to 'anything else?'"""
        call_data.switch_department("closing")
        return ClosingAgent(call_data, tools=tools_container), ""  # This one CAN stay empty - it's the wrap-up

    @function_tool()
    async def route_to_service():
        """Route to service team for equipment repairs, breakdowns, emergencies"""
        call_data.switch_department("service")
        return ServiceAgent(call_data, tools=tools_container), "Let me pull up your service history."

    @function_tool()
    async def route_to_billing():
        """Route to billing team for invoice questions, payments, disputes"""
        call_data.switch_department("billing")
        return BillingAgent(call_data, tools=tools_container), "Let me check on that for you."

    @function_tool()
    async def route_to_parts():
        """Route to parts team for part orders, ETAs, availability"""
        call_data.switch_department("parts")
        return PartsAgent(call_data, tools=tools_container), "Let me look into that part."

    @function_tool()
    async def route_to_projects():
        """Route to projects team for quotes, bids, installations"""
        call_data.switch_department("projects")
        return ProjectsAgent(call_data, tools=tools_container), "Let me get you to the right person for that."

    @function_tool()
    async def route_to_maintenance():
        """Route to maintenance team for PM scheduling, contracts, agreements"""
        call_data.switch_department("maintenance")
        return MaintenanceAgent(call_data, tools=tools_container), "Let me pull up your maintenance agreement."

    @function_tool()
    async def route_to_controls():
        """Route to controls team for BAS, thermostats, building automation"""
        call_data.switch_department("controls")
        return ControlsAgent(call_data, tools=tools_container), "Let me check on your system."

    @function_tool()
    async def route_to_general():
        """Route to office/general team for COI requests, certificates of insurance, feedback, complaints, salespeople, vendor calls, or general inquiries that don't fit other departments"""
        call_data.switch_department("general")
        return GeneralAgent(call_data, tools=tools_container), "Let me help you with that."

    # Build the tools list and populate the container
    tools = [
        route_to_closing,
        route_to_service,
        route_to_billing,
        route_to_parts,
        route_to_projects,
        route_to_maintenance,
        route_to_controls,
        route_to_general,
    ]
    tools_container.extend(tools)

    return tools


def warmup_whisper():
    """Pre-load whisper model before accepting calls"""
    print("Warming up Whisper model for HVAC Grace...")
    try:
        sample_rate = 16000
        num_samples = sample_rate * 1
        wav_buffer = io.BytesIO()
        wav_buffer.write(b'RIFF')
        wav_buffer.write(struct.pack('<I', 36 + num_samples * 2))
        wav_buffer.write(b'WAVE')
        wav_buffer.write(b'fmt ')
        wav_buffer.write(struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        wav_buffer.write(b'data')
        wav_buffer.write(struct.pack('<I', num_samples * 2))
        wav_buffer.write(b'\x00' * (num_samples * 2))
        wav_data = wav_buffer.getvalue()

        resp = requests.post(
            os.getenv("STT_BASE_URL", "http://localhost:9000/v1") + "/audio/transcriptions",
            files={"file": ("warmup.wav", wav_data, "audio/wav")},
            data={"model": os.getenv("STT_MODEL", "Systran/faster-whisper-large-v3")},
            timeout=120
        )
        resp.raise_for_status()
        print("HVAC Grace: Whisper model ready!")
    except Exception as e:
        print(f"Warmup note: {e} (model will load on first call)")


# Create the agent server
server = AgentServer()


@server.rtc_session()
async def hvac_agent(ctx: agents.JobContext):
    """Main HVAC agent session handler with multi-agent routing"""
    global _current_call_data

    # Initialize call data for this session
    call_data = CallData(room_name=ctx.room.name)
    _current_call_data = call_data

    print(f"\n{'='*60}")
    print(f"NEW CALL: {call_data.room_name}")
    print(f"{'='*60}\n")

    # Initialize VAD with tuned silence duration
    vad = silero.VAD.load(min_silence_duration=0.5)  # Increased for better end-of-utterance detection

    # Initialize Whisper STT
    whisper_stt = openai.STT(
        base_url=os.getenv("STT_BASE_URL", "http://localhost:9000/v1"),
        model=os.getenv("STT_MODEL", "Systran/faster-whisper-large-v3"),
    )

    stt_with_vad = stt.StreamAdapter(stt=whisper_stt, vad=vad)

    # Shared LLM configuration
    llm = openai.LLM(
        model=os.getenv("LLM_MODEL", "Qwen/Qwen2.5-32B-Instruct-AWQ"),
        base_url=os.getenv("LLM_BASE_URL", "http://localhost:8080/v1").rsplit("/chat/completions", 1)[0],
        api_key="not-needed",
        temperature=0.4
    )

    # Shared TTS configuration with filtering
    raw_tts = openai.TTS(
        base_url=os.getenv("TTS_BASE_URL", "http://localhost:8880/v1"),
        model="kokoro",
        voice=os.getenv("TTS_VOICE", "af_heart"),
    )
    tts = FilteredTTS(raw_tts)

    # Create the agent session with tuned turn-taking settings
    # - min_endpointing_delay: Increased from 0.5 to 0.8 for more patience before end-of-speech
    # - min_interruption_duration: Increased to 0.6 to avoid false interruptions
    # - false_interruption_timeout: Slightly increased for smoother recovery
    session = AgentSession(
        stt=stt_with_vad,
        llm=llm,
        tts=tts,
        turn_detection=MultilingualModel(),
        min_endpointing_delay=0.8,       # +300ms patience before detecting end of speech
        min_interruption_duration=0.6,   # Require 600ms speech to count as interruption
        false_interruption_timeout=2.5,  # Slightly longer recovery from false interrupts
    )

    # Room options with noise cancellation
    room_options = room_io.RoomOptions(
        audio_input=room_io.AudioInputOptions(
            noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
            if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
            else noise_cancellation.BVC(),
        ),
    )

    # State tracking for routing
    has_transferred = False

    # Create routing tools for this call session
    routing_tools = create_routing_tools(call_data)

    # =========================================================================
    # REAL-TIME TRANSCRIPT CAPTURE
    # These event handlers persist for the entire call
    # =========================================================================

    @session.on("user_input_transcribed")
    def on_user_speech(event):
        """Capture every user utterance in real-time"""
        text = event.transcript if hasattr(event, 'transcript') else str(event)
        if text and text.strip():
            call_data.add_transcript_line("Caller", text)
            # Try to extract caller info
            extract_caller_info_from_text(text, call_data)

    @session.on("conversation_item_added")
    def on_conversation_item(event):
        """Capture conversation items (both user and agent) in real-time"""
        item = event.item
        # Check if this is a ChatMessage with assistant role
        if hasattr(item, 'role') and item.role == 'assistant':
            # Get text content from the message
            text = item.text_content if hasattr(item, 'text_content') else None
            if not text and hasattr(item, 'content'):
                # content is a list of ChatContent objects
                text_parts = []
                for part in item.content:
                    if hasattr(part, 'text'):
                        text_parts.append(part.text)
                text = ' '.join(text_parts)
            if text and text.strip():
                call_data.add_transcript_line("Grace", text.strip())

    # =========================================================================
    # AUDIO CAPTURE (Using AudioStream for SDK compatibility)
    # Captures raw audio frames for recording using async AudioStream
    # =========================================================================

    async def capture_audio_frames(track: rtc.RemoteAudioTrack):
        """Async task to capture audio frames from AudioStream"""
        try:
            audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
            async for event in audio_stream:
                if hasattr(event, 'frame') and hasattr(event.frame, 'data'):
                    call_data.audio_frames.append(bytes(event.frame.data))
        except Exception as e:
            print(f"Audio capture error: {e}")

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        """Start capturing audio when we subscribe to caller's audio track"""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"Subscribed to audio from {participant.identity}")
            # Start async audio capture task
            asyncio.create_task(capture_audio_frames(track))

    # =========================================================================
    # START SESSION
    # =========================================================================

    await session.start(
        room=ctx.room,
        agent=PortalAgent(),
        room_options=room_options,
    )

    # Portal greeting
    await session.generate_reply(
        instructions=f"Greet the caller: Thanks for calling {COMPANY_NAME}, this is Grace. What can I help you with today?"
    )

    # =========================================================================
    # ROUTING LOGIC (Silent Handoff)
    # =========================================================================

    @session.on("user_input_transcribed")
    def on_user_speech_for_routing(event):
        nonlocal has_transferred

        # Only process first substantial utterance for routing
        if has_transferred:
            return

        user_text = event.transcript if hasattr(event, 'transcript') else str(event)

        if len(user_text.strip()) < 5:
            return

        has_transferred = True
        intent = detect_intent(user_text)
        call_data.switch_department(intent)

        asyncio.create_task(perform_transfer(session, intent, user_text, call_data))

    async def perform_transfer(session: AgentSession, intent: str, context: str, call_data: CallData):
        """Transfer to specialist agent with proper handoff"""

        # Map intent to agent class
        agent_map = {
            "service": ServiceAgent,
            "parts": PartsAgent,
            "billing": BillingAgent,
            "projects": ProjectsAgent,
            "maintenance": MaintenanceAgent,
            "controls": ControlsAgent,
            "general": GeneralAgent,
            "closing": ClosingAgent,
        }

        agent_class = agent_map.get(intent, GeneralAgent)

        # Capture handoff context before transfer
        call_data.set_handoff_context(
            caller_statement=context if context else "",
            intent=intent,
            grace_response=call_data.transcript_lines[-1] if call_data.transcript_lines else ""
        )

        # Create the new agent with routing tools
        new_agent = agent_class(call_data, tools=routing_tools)

        # Update to the new agent - on_enter() will be called automatically
        session.update_agent(new_agent)

        # Trigger the new agent to respond
        await session.generate_reply()

    # =========================================================================
    # DISCONNECT HANDLING
    # =========================================================================

    disconnected = asyncio.Event()

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnect(participant):
        print(f"HVAC call ended: {participant.identity}")
        disconnected.set()

    @ctx.room.on("disconnected")
    def on_room_disconnect():
        print("HVAC room disconnected")
        disconnected.set()

    # Wait for call to end
    await disconnected.wait()
    await asyncio.sleep(1)

    # Process the call
    print("Processing HVAC call...")
    await process_call_end(call_data)

    # Cleanup
    _current_call_data = None


if __name__ == "__main__":
    warmup_whisper()
    agents.cli.run_app(server)
