#!/usr/bin/env python3
"""
HVAC Grace V2 Testing Framework
Tests the single-agent architecture with:
- Dynamic prompt rebuilding
- Customer recognition
- Ticket actions (status, update, cancel)
- FAQ handling
- Department context switching

This framework simulates the state management that happens in grace_agent.py
without requiring actual voice calls.
"""

import asyncio
import aiohttp
import json
import os
import sys
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

# Configuration
LLM_URL = os.getenv("LLM_BASE_URL", "http://localhost:8080/v1")
API_URL = os.getenv("API_BASE_URL", "http://localhost:8097")
N8N_TICKET_URL = os.getenv("N8N_TICKET_URL", "http://localhost:5679/webhook/ticket")
COMPANY_NAME = os.getenv("COMPANY_NAME", "Light Heart Mechanical")

# Import V2 scenarios
from stress_tests_v2 import (
    V2_STRESS_SCENARIOS, PRESEEDED_CUSTOMERS, PRESEEDED_TICKETS,
    RECOGNITION_SCENARIOS, FAQ_SCENARIOS, CONTEXT_SWITCHING_SCENARIOS,
    EDGE_CASE_SCENARIOS, COMBINED_STRESS_SCENARIOS, SCENARIO_COUNTS
)


# =============================================================================
# SIMULATED V2 STATE (mirrors state.py from grace_agent)
# =============================================================================

@dataclass
class SimulatedCallState:
    """Simulates the CallState from the V2 agent"""
    call_id: str = ""
    call_start: datetime = field(default_factory=datetime.now)

    # Phase tracking
    phase: str = "greeting"
    department: str = "general"
    departments_visited: List[str] = field(default_factory=list)

    # Customer recognition
    customer: Optional[Dict] = None
    customer_id: Optional[int] = None
    is_recognized: bool = False
    open_tickets: List[Dict] = field(default_factory=list)

    # Caller info
    caller_name: str = ""
    caller_phone: str = ""
    caller_company: str = ""
    caller_site: str = ""

    # Tickets
    tickets_in_progress: Dict[str, Dict] = field(default_factory=dict)
    completed_tickets: List[Dict] = field(default_factory=list)
    ticket_actions: List[Dict] = field(default_factory=list)

    # Transcript
    transcript_lines: List[Dict] = field(default_factory=list)

    # FAQ
    faq_context: Optional[str] = None

    def add_transcript_line(self, speaker: str, text: str):
        self.transcript_lines.append({
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "speaker": speaker,
            "text": text,
            "department": self.department
        })

    def switch_department(self, new_dept: str):
        if new_dept != self.department:
            self.department = new_dept
            if new_dept not in self.departments_visited:
                self.departments_visited.append(new_dept)
            if new_dept not in self.tickets_in_progress:
                self.tickets_in_progress[new_dept] = {}

    def set_ticket_field(self, field: str, value: str):
        if self.department not in self.tickets_in_progress:
            self.tickets_in_progress[self.department] = {}
        self.tickets_in_progress[self.department][field] = value

    def record_ticket_action(self, action: str, ticket_id: int, **kwargs):
        self.ticket_actions.append({
            "action": action,
            "ticket_id": ticket_id,
            "timestamp": datetime.now().isoformat(),
            **kwargs
        })


# =============================================================================
# SIMULATED V2 MODULES
# =============================================================================

# Department keywords (from intent_detection.py)
DEPARTMENT_KEYWORDS = {
    "service": [
        "service", "repair", "broken", "not working", "stopped working",
        "emergency", "no heat", "no cooling", "no ac", "no air",
        "leaking", "noise", "loud", "smell", "smoke", "frozen",
        "won't turn on", "tripped", "down", "offline"
    ],
    "billing": [
        "billing", "invoice", "bill", "payment", "pay", "charge",
        "statement", "account", "balance", "credit", "refund",
        "dispute", "overcharge"
    ],
    "parts": [
        "part", "parts", "filter", "belt", "motor", "compressor",
        "order", "ordering", "pickup"
    ],
    "projects": [
        "project", "quote", "estimate", "install", "installation",
        "replace", "replacement", "new unit", "upgrade", "bid"
    ],
    "maintenance": [
        "maintenance", "pm", "preventive", "contract", "agreement",
        "scheduled", "routine"
    ],
    "controls": [
        "controls", "bas", "building automation", "niagara", "trane tracer",
        "metasys", "honeywell", "bacnet", "sensor", "setpoint"
    ]
}

# FAQ patterns
FAQ_PATTERNS = {
    "hours": [r"hours", r"open", r"office hours", r"when are you"],
    "residential": [r"home", r"house", r"residential", r"my home", r"apartment"],
    "service_area": [r"service area", r"do you (cover|service)", r"wilmington", r"outside"],
    "emergency_service": [r"24.?7", r"emergency service", r"after hours", r"weekend"],
    "payment": [r"credit card", r"payment method", r"how do (we|i) pay"]
}

FAQ_RESPONSES = {
    "hours": "Our office hours are Monday through Friday, 7 AM to 5 PM Eastern. We have 24/7 emergency service available.",
    "residential": "We're a commercial HVAC company only. For residential service, I'd recommend checking with local residential contractors.",
    "service_area": "We service the Greater Philadelphia area including Philadelphia, Bucks, Montgomery, Chester, and Delaware counties.",
    "emergency_service": "Yes, we provide 24/7 emergency service. After-hours rates apply but we can dispatch technicians any time.",
    "payment": "We accept checks, ACH transfers, and credit cards. Our billing team can set up the payment method that works best for you."
}


def detect_department(text: str) -> Optional[str]:
    """Detect department from text"""
    text_lower = text.lower()
    scores = {}
    for dept, keywords in DEPARTMENT_KEYWORDS.items():
        score = sum(len(kw) for kw in keywords if kw in text_lower)
        if score > 0:
            scores[dept] = score
    return max(scores, key=scores.get) if scores else None


def detect_faq(text: str) -> Optional[str]:
    """Detect FAQ question"""
    text_lower = text.lower()
    for faq_type, patterns in FAQ_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return faq_type
    return None


def detect_ticket_status_request(text: str) -> bool:
    """Detect ticket status inquiry"""
    patterns = [r"status", r"check on", r"update on", r"what.?s happening", r"when.+tech"]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)


def detect_ticket_cancel_request(text: str) -> bool:
    """Detect ticket cancellation"""
    patterns = [r"cancel", r"don.?t need", r"fixed it", r"disregard"]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)


def extract_caller_info(text: str, state: SimulatedCallState):
    """Extract caller info from text"""
    # Simple extraction patterns
    if not state.caller_phone:
        phone_match = re.search(r'(\d{3}[-.]?\d{3}[-.]?\d{4})', text)
        if phone_match:
            state.caller_phone = re.sub(r'[^0-9]', '', phone_match.group(1))

    # Name extraction (simple heuristic)
    if not state.caller_name:
        name_patterns = [
            r"(?:my name is|i'm|this is|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"^([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+(?:here|calling))?$"
        ]
        for pattern in name_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                state.caller_name = match.group(1).title()
                break


# =============================================================================
# PROMPT BUILDER (simplified from prompt_builder.py)
# =============================================================================

BASE_PERSONA = """You are Grace, the AI receptionist for Light Heart Mechanical, a commercial HVAC company in Philadelphia.

VOICE & PERSONALITY:
- Warm, professional, and efficient
- Use natural conversational language
- Keep responses concise (1-2 sentences typically)

CORE RULES:
1. NEVER make up information
2. NEVER promise specific arrival times
3. NEVER discuss pricing
4. Collect information conversationally
5. We are COMMERCIAL only - no residential
6. 24/7 emergency service available"""


DEPARTMENT_SCRIPTS = {
    "service": """You're taking a SERVICE call. Gather: name, phone, site, equipment, issue, urgency.""",
    "billing": """You're handling BILLING. Gather: name, phone, invoice number or topic.""",
    "parts": """You're handling PARTS. Gather: name, phone, part details.""",
    "projects": """You're handling PROJECTS. Gather: name, phone, project scope, timeline.""",
    "maintenance": """You're handling MAINTENANCE. Gather: name, phone, site, contract question.""",
    "controls": """You're handling CONTROLS. Gather: name, phone, site, BAS type, issue.""",
    "general": """General inquiry. Listen for keywords to route appropriately."""
}


def build_prompt(state: SimulatedCallState) -> str:
    """Build system prompt from state"""
    sections = [BASE_PERSONA]

    # Customer context
    if state.is_recognized and state.customer:
        c = state.customer
        first_name = c.get('name', 'there').split()[0]
        sections.append(f"""
# RECOGNIZED CUSTOMER
Name: {c.get('name')}
Company: {c.get('company')}
Total calls: {c.get('total_calls', 0)}
Notes: {c.get('notes', 'None')}

Greet warmly by name. Do NOT ask for name or phone.""")

    # Open tickets
    if state.open_tickets:
        sections.append(f"""
# CALLER'S OPEN TICKETS
{len(state.open_tickets)} open tickets. Offer to check on them.""")
        for t in state.open_tickets:
            sections.append(f"- #{t['id']}: {t.get('category', 'unknown')} - {t.get('issue_brief', 'N/A')}")

    # Department script
    sections.append(f"\n# CURRENT DEPARTMENT: {state.department.upper()}")
    sections.append(DEPARTMENT_SCRIPTS.get(state.department, DEPARTMENT_SCRIPTS["general"]))

    # Known info
    known = []
    if state.caller_name:
        known.append(f"- Name: {state.caller_name}")
    if state.caller_phone:
        known.append(f"- Phone: {state.caller_phone}")
    if known:
        sections.append(f"\n# ALREADY KNOWN (don't re-ask):\n" + "\n".join(known))

    # FAQ context
    if state.faq_context:
        sections.append(f"\n# FAQ ANSWER:\n{state.faq_context}")

    return "\n".join(sections)


# =============================================================================
# TICKET EXTRACTION AND SUBMISSION
# =============================================================================

async def extract_tickets_from_transcript(state: SimulatedCallState) -> List[Dict]:
    """Use LLM to extract ticket data from conversation transcript"""
    transcript_str = "\n".join([
        f"[{entry['speaker'].upper()}] {entry['text']}"
        for entry in state.transcript_lines
    ])

    extraction_prompt = f"""Extract ALL service/support tickets from this HVAC call transcript.

Return a JSON object with this structure:
{{
  "caller_name": "name of caller",
  "caller_phone": "phone number (digits only)",
  "caller_company": "company name if mentioned",
  "tickets": [
    {{
      "category": "service|billing|parts|projects|maintenance|controls|general",
      "urgency": "emergency|urgent|normal",
      "site_name": "building/site name",
      "site_address": "address if given",
      "equipment_type": "type of equipment",
      "equipment_location": "where equipment is located",
      "issue_brief": "brief description of issue/request",
      "notes": "any additional details"
    }}
  ]
}}

Rules:
- Only include tickets where caller clearly needs action (not status checks)
- If no tickets, return empty tickets array
- If info is missing, use empty string
- Keep issue_brief under 100 characters

Transcript:
{transcript_str}

Return ONLY the JSON object, no other text."""

    messages = [
        {"role": "system", "content": "Extract structured ticket data from call transcripts. Return only valid JSON."},
        {"role": "user", "content": extraction_prompt}
    ]

    response = await call_llm(messages, model="Qwen/Qwen2.5-32B-Instruct-AWQ")

    if "error" in response:
        print(f"  [EXTRACTION ERROR] {response['error'][:100]}")
        return []

    try:
        content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        # Find JSON in response
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            data = json.loads(json_match.group())
            tickets = data.get("tickets", [])
            # Add caller info to each ticket
            for t in tickets:
                t["caller_name"] = data.get("caller_name", state.caller_name) or state.caller_name
                t["caller_phone"] = data.get("caller_phone", state.caller_phone) or state.caller_phone
                t["caller_company"] = data.get("caller_company", state.caller_company) or state.caller_company
            return tickets
    except Exception as e:
        print(f"  [EXTRACTION ERROR] {str(e)}")

    return []


async def submit_ticket_to_n8n(ticket: Dict) -> Optional[int]:
    """Submit a ticket to n8n webhook"""
    # Build payload matching n8n expectations
    payload = {
        "caller_name": ticket.get("caller_name", ""),
        "caller_phone": ticket.get("caller_phone", ""),
        "caller_company": ticket.get("caller_company", ""),
        "category": ticket.get("category", "general"),
        "urgency": ticket.get("urgency", "normal"),
        "site_name": ticket.get("site_name", ""),
        "site_address": ticket.get("site_address", ""),
        "equipment_type": ticket.get("equipment_type", ""),
        "equipment_location": ticket.get("equipment_location", ""),
        "issue_brief": ticket.get("issue_brief", ""),
        "notes": ticket.get("notes", ""),
        "source": "test_framework_v2"
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                N8N_TICKET_URL,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    ticket_id = data.get("id") or data.get("ticketId")
                    if ticket_id:
                        print(f"  [TICKET CREATED] #{ticket_id}: {ticket.get('category')} - {ticket.get('issue_brief', '')[:50]}")
                        return ticket_id
                else:
                    text = await resp.text()
                    print(f"  [TICKET ERROR] {resp.status}: {text[:100]}")
    except Exception as e:
        print(f"  [TICKET ERROR] {str(e)}")

    return None


# =============================================================================
# TEST RESULT TRACKING
# =============================================================================

@dataclass
class TestResult:
    """Results from a single test scenario"""
    scenario_name: str
    scenario_key: str
    passed: bool = False

    # Expected vs Actual
    expected_departments: List[str] = field(default_factory=list)
    actual_departments: List[str] = field(default_factory=list)
    expected_tickets: int = 0
    actual_tickets: int = 0
    expected_recognition: Optional[bool] = None
    actual_recognition: bool = False

    # Metrics
    total_turns: int = 0
    context_switches: int = 0
    faq_triggers: List[str] = field(default_factory=list)
    ticket_actions: List[str] = field(default_factory=list)

    # Behavior checks
    behavior_checks: Dict[str, bool] = field(default_factory=dict)

    # Errors
    errors: List[str] = field(default_factory=list)

    # Timing
    duration_seconds: float = 0.0

    def evaluate(self):
        """Evaluate if test passed"""
        checks = []

        # Department check
        dept_match = all(d in self.actual_departments for d in self.expected_departments)
        checks.append(dept_match)

        # Ticket count check
        ticket_match = self.actual_tickets >= self.expected_tickets
        checks.append(ticket_match)

        # Recognition check (if specified)
        if self.expected_recognition is not None:
            checks.append(self.actual_recognition == self.expected_recognition)

        # No errors
        checks.append(len(self.errors) == 0)

        self.passed = all(checks)


# =============================================================================
# CALL SIMULATOR V2
# =============================================================================

async def call_llm(messages: list, model: str = "Qwen/Qwen2.5-32B-Instruct-AWQ") -> dict:
    """Call the local LLM"""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 500
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(
                f"{LLM_URL}/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    return {"error": f"LLM error {resp.status}: {text[:200]}"}
                return await resp.json()
        except Exception as e:
            return {"error": f"LLM connection error: {str(e)}"}


async def lookup_customer(phone: str) -> Optional[Dict]:
    """Look up customer by phone (simulated or real API)"""
    # First check preseeded customers
    normalized = re.sub(r'[^0-9]', '', phone)
    for c in PRESEEDED_CUSTOMERS:
        if re.sub(r'[^0-9]', '', c['phone']) == normalized:
            return c

    # Try real API if available
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{API_URL}/webhook/customer/lookup",
                json={"phone": phone},
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("found"):
                        return data.get("customer")
    except:
        pass

    return None


async def get_open_tickets(customer_id: int = None, phone: str = None) -> List[Dict]:
    """Get open tickets for customer (simulated)"""
    # Check preseeded tickets
    results = []
    normalized_phone = re.sub(r'[^0-9]', '', phone or '')
    for t in PRESEEDED_TICKETS:
        if re.sub(r'[^0-9]', '', t.get('caller_phone', '')) == normalized_phone:
            results.append(t)
    return results


class CallSimulatorV2:
    """Simulates a call through the V2 single-agent architecture"""

    def __init__(self, scenario: dict, scenario_key: str):
        self.scenario = scenario
        self.scenario_key = scenario_key
        self.state = SimulatedCallState(
            call_id=f"test_{scenario_key}_{datetime.now().strftime('%H%M%S')}"
        )
        self.conversation_history = []
        self.script_index = 0
        self.max_turns = 60

    def get_next_caller_input(self) -> Optional[str]:
        """Get next line from script"""
        script = self.scenario.get("script", [])
        if self.script_index < len(script):
            line = script[self.script_index]
            self.script_index += 1
            return line
        return None

    async def simulate_customer_recognition(self):
        """Simulate customer lookup from phone"""
        if self.state.caller_phone:
            customer = await lookup_customer(self.state.caller_phone)
            if customer:
                self.state.customer = customer
                self.state.customer_id = customer.get('id')
                self.state.is_recognized = True
                self.state.caller_name = customer.get('name', '')
                self.state.caller_company = customer.get('company', '')

                # Get open tickets
                self.state.open_tickets = await get_open_tickets(phone=self.state.caller_phone)

                print(f"  [RECOGNIZED] {customer.get('name')} - {len(self.state.open_tickets)} open tickets")

    async def process_user_input(self, text: str):
        """Process user input and update state (mirrors grace_agent.py logic)"""
        # Extract caller info
        extract_caller_info(text, self.state)

        # Try customer lookup if phone detected and not yet recognized
        if self.state.caller_phone and not self.state.is_recognized:
            await self.simulate_customer_recognition()

        # Check for FAQ
        faq_type = detect_faq(text)
        if faq_type:
            self.state.faq_context = FAQ_RESPONSES.get(faq_type, "")
            print(f"  [FAQ] {faq_type}")
        else:
            self.state.faq_context = None

        # Check for ticket actions (if recognized with open tickets)
        if self.state.is_recognized and self.state.open_tickets:
            if detect_ticket_status_request(text):
                ticket_id = self.state.open_tickets[0].get('id')
                self.state.record_ticket_action("status_check", ticket_id)
                print(f"  [TICKET ACTION] Status check for #{ticket_id}")
            elif detect_ticket_cancel_request(text):
                ticket_id = self.state.open_tickets[0].get('id')
                self.state.record_ticket_action("cancel", ticket_id)
                print(f"  [TICKET ACTION] Cancel #{ticket_id}")

        # Detect department
        new_dept = detect_department(text)
        if new_dept and new_dept != self.state.department:
            print(f"  [DEPT SWITCH] {self.state.department} -> {new_dept}")
            self.state.switch_department(new_dept)

    async def run_agent_turn(self, user_input: str) -> str:
        """Run agent response turn"""
        # Build prompt from current state
        system_prompt = build_prompt(self.state)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self.conversation_history[-10:])  # Keep last 10 turns
        messages.append({"role": "user", "content": user_input})

        response = await call_llm(messages)

        if "error" in response:
            return f"[ERROR: {response['error']}]"

        try:
            agent_text = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            self.conversation_history.append({"role": "user", "content": user_input})
            if agent_text:
                self.conversation_history.append({"role": "assistant", "content": agent_text})
            return agent_text or "[no response]"
        except Exception as e:
            return f"[ERROR: {str(e)}]"

    async def simulate_call(self) -> TestResult:
        """Run the full call simulation"""
        start_time = datetime.now()

        result = TestResult(
            scenario_name=self.scenario.get("name", "Unknown"),
            scenario_key=self.scenario_key,
            expected_departments=self.scenario.get("expected_departments", []),
            expected_tickets=self.scenario.get("expected_tickets", 0),
            expected_recognition=self.scenario.get("expected_recognition")
        )

        print(f"\n{'='*70}")
        print(f"SCENARIO: {result.scenario_name}")
        print(f"{'='*70}")

        # Handle pre-seeded data
        if self.scenario.get("pre_seed_customer"):
            c = self.scenario["pre_seed_customer"]
            # Pre-populate phone for recognition
            self.state.caller_phone = re.sub(r'[^0-9]', '', c['phone'])
            await self.simulate_customer_recognition()

        if self.scenario.get("pre_seed_ticket"):
            self.state.open_tickets = [self.scenario["pre_seed_ticket"]]

        # Initial greeting
        if self.state.is_recognized and self.state.customer:
            first_name = self.state.customer.get('name', 'there').split()[0]
            greeting = f"Hi {first_name}, thanks for calling Light Heart Mechanical! Good to hear from you. How can I help you today?"
        else:
            greeting = "Thanks for calling Light Heart Mechanical, this is Grace. How can I help you today?"

        self.state.add_transcript_line("grace", greeting)
        print(f"\nGrace: {greeting}")

        # Run conversation
        turn = 0
        while turn < self.max_turns:
            turn += 1

            caller_input = self.get_next_caller_input()
            if caller_input is None:
                print("\n[Script complete]")
                break

            if caller_input.startswith("["):
                print(f"\n{caller_input}")
                if "HANGUP" in caller_input:
                    break
                continue

            self.state.add_transcript_line("caller", caller_input)
            print(f"\nCaller: {caller_input}")

            # Process input (state updates)
            await self.process_user_input(caller_input)

            # Get agent response
            agent_response = await self.run_agent_turn(caller_input)
            self.state.add_transcript_line("grace", agent_response)
            print(f"Grace: {agent_response[:200]}{'...' if len(agent_response) > 200 else ''}")

            result.total_turns += 1

        # Extract and submit tickets
        print("\n[Extracting tickets from conversation...]")
        extracted_tickets = await extract_tickets_from_transcript(self.state)

        submitted_ticket_ids = []
        if extracted_tickets:
            print(f"[Found {len(extracted_tickets)} ticket(s) to submit]")
            for ticket in extracted_tickets:
                ticket_id = await submit_ticket_to_n8n(ticket)
                if ticket_id:
                    submitted_ticket_ids.append(ticket_id)

        # Finalize results
        result.actual_departments = self.state.departments_visited.copy()
        result.actual_recognition = self.state.is_recognized
        result.actual_tickets = len(submitted_ticket_ids)
        result.ticket_actions = [a['action'] for a in self.state.ticket_actions]
        result.context_switches = max(0, len(self.state.departments_visited) - 1)
        result.duration_seconds = (datetime.now() - start_time).total_seconds()

        # Check expected behaviors
        expected_behaviors = self.scenario.get("expected_behaviors", [])
        for behavior in expected_behaviors:
            # Simplified behavior checks
            if behavior == "greet_by_name":
                result.behavior_checks[behavior] = self.state.is_recognized
            elif behavior == "no_ask_for_name":
                result.behavior_checks[behavior] = self.state.is_recognized
            else:
                result.behavior_checks[behavior] = True  # Placeholder

        result.evaluate()

        return result


# =============================================================================
# TEST RUNNER
# =============================================================================

def print_result_summary(result: TestResult):
    """Print summary for a single test result"""
    status = "PASS" if result.passed else "FAIL"
    print(f"\n{'-'*50}")
    print(f"{status}: {result.scenario_name}")
    print(f"  Departments: Expected {result.expected_departments}, Got {result.actual_departments}")
    print(f"  Tickets: Expected {result.expected_tickets}, Got {result.actual_tickets}")
    if result.expected_recognition is not None:
        print(f"  Recognition: Expected {result.expected_recognition}, Got {result.actual_recognition}")
    if result.ticket_actions:
        print(f"  Ticket Actions: {result.ticket_actions}")
    print(f"  Duration: {result.duration_seconds:.1f}s, Turns: {result.total_turns}")
    if result.errors:
        print(f"  Errors: {result.errors}")


async def run_scenario(scenario_key: str) -> TestResult:
    """Run a single scenario by key"""
    if scenario_key not in V2_STRESS_SCENARIOS:
        print(f"Unknown scenario: {scenario_key}")
        return None

    scenario = V2_STRESS_SCENARIOS[scenario_key]
    simulator = CallSimulatorV2(scenario, scenario_key)
    result = await simulator.simulate_call()
    print_result_summary(result)
    return result


async def run_category(category: str) -> List[TestResult]:
    """Run all scenarios in a category"""
    categories = {
        "recognition": RECOGNITION_SCENARIOS,
        "faq": FAQ_SCENARIOS,
        "context": CONTEXT_SWITCHING_SCENARIOS,
        "edge": EDGE_CASE_SCENARIOS,
        "stress": COMBINED_STRESS_SCENARIOS
    }

    if category not in categories:
        print(f"Unknown category: {category}")
        print(f"Available: {list(categories.keys())}")
        return []

    scenarios = categories[category]
    results = []

    for key in sorted(scenarios.keys()):
        result = await run_scenario(key)
        if result:
            results.append(result)
        await asyncio.sleep(0.5)

    return results


async def run_all_scenarios() -> List[TestResult]:
    """Run all V2 stress test scenarios"""
    results = []

    print("\n" + "#"*70)
    print("# HVAC GRACE V2 COMPREHENSIVE STRESS TEST")
    print("#"*70)

    for key in sorted(V2_STRESS_SCENARIOS.keys()):
        result = await run_scenario(key)
        if result:
            results.append(result)
        await asyncio.sleep(0.5)

    # Print comprehensive summary
    print("\n" + "="*70)
    print("COMPREHENSIVE TEST SUMMARY")
    print("="*70)

    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)

    print(f"\nTotal Scenarios: {len(results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Pass Rate: {passed/len(results)*100:.1f}%")

    # Category breakdown
    print("\nBy Category:")
    for cat_name, cat_prefix in [
        ("Recognition", "recog"),
        ("FAQ", "faq"),
        ("Context Switch", "switch"),
        ("Edge Cases", "edge"),
        ("Stress", "stress")
    ]:
        cat_results = [r for r in results if r.scenario_key.startswith(cat_prefix)]
        if cat_results:
            cat_passed = sum(1 for r in cat_results if r.passed)
            print(f"  {cat_name}: {cat_passed}/{len(cat_results)} passed")

    # Failed tests detail
    if failed > 0:
        print("\nFailed Tests:")
        for r in results:
            if not r.passed:
                print(f"  - {r.scenario_key}: {r.scenario_name}")
                if r.errors:
                    print(f"    Errors: {r.errors[:2]}")

    return results


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="HVAC Grace V2 Testing Framework")
    parser.add_argument("--scenario", "-s", help="Run specific scenario by key")
    parser.add_argument("--category", "-c",
                       choices=["recognition", "faq", "context", "edge", "stress"],
                       help="Run all scenarios in category")
    parser.add_argument("--all", "-a", action="store_true", help="Run all scenarios")
    parser.add_argument("--list", "-l", action="store_true", help="List all scenarios")

    args = parser.parse_args()

    if args.list:
        print("Available V2 Stress Test Scenarios:")
        print("="*50)
        for key, scenario in sorted(V2_STRESS_SCENARIOS.items()):
            print(f"  {key}: {scenario.get('name', 'Unknown')}")
        print(f"\nTotal: {len(V2_STRESS_SCENARIOS)} scenarios")
    elif args.scenario:
        asyncio.run(run_scenario(args.scenario))
    elif args.category:
        asyncio.run(run_category(args.category))
    elif args.all:
        asyncio.run(run_all_scenarios())
    else:
        # Default: run all
        asyncio.run(run_all_scenarios())
