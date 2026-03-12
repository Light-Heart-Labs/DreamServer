"""
HVAC Grace - Dynamic Prompt Builder
Constructs system prompts based on current call state.

This version is compatible with the multi-agent system - it reads from the
actual prompt files in the prompts/ directory rather than using embedded scripts.
"""

import os
from typing import Optional
from state import CallState, get_missing_required_fields

# Import the actual prompt modules from the multi-agent system
try:
    from prompts.portal import PORTAL_INSTRUCTION
    from prompts.service import SERVICE_INSTRUCTION
    from prompts.billing import BILLING_INSTRUCTION
    from prompts.parts import PARTS_INSTRUCTION
    from prompts.projects import PROJECTS_INSTRUCTION
    from prompts.maintenance import MAINTENANCE_INSTRUCTION
    from prompts.controls import CONTROLS_INSTRUCTION
    from prompts.office import OFFICE_INSTRUCTION
    from prompts.closing import CLOSING_INSTRUCTION
    PROMPTS_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import prompt modules: {e}")
    PROMPTS_AVAILABLE = False




def get_department_prompt(department: str) -> str:
    """Get the prompt instruction for a specific department."""
    if not PROMPTS_AVAILABLE:
        return f"[Prompt for {department} not available - prompts module not loaded]"

    if department == "portal":
        return PORTAL_INSTRUCTION
    elif department == "service":
        return SERVICE_INSTRUCTION
    elif department == "billing":
        return BILLING_INSTRUCTION
    elif department == "parts":
        return PARTS_INSTRUCTION
    elif department == "projects":
        return PROJECTS_INSTRUCTION
    elif department == "maintenance":
        return MAINTENANCE_INSTRUCTION
    elif department == "controls":
        return CONTROLS_INSTRUCTION
    elif department in ["office", "general"]:
        return OFFICE_INSTRUCTION
    elif department == "closing":
        return CLOSING_INSTRUCTION
    else:
        return OFFICE_INSTRUCTION  # Default to office for unknown


def build_customer_context(state: CallState) -> str:
    """Build context section for recognized customer."""
    if not state.customer:
        return ""

    c = state.customer
    first_name = c.get('name', 'there').split()[0] if c.get('name') else 'there'

    context = f"""
# RECOGNIZED CUSTOMER
This is a RETURNING CALLER - you know them!

Name: {c.get('name', 'Unknown')}
Company: {c.get('company', 'N/A')}
Total previous calls: {c.get('total_calls', 0)}
Last call: {c.get('last_call_date', 'N/A')[:10] if c.get('last_call_date') else 'N/A'}
Notes: {c.get('notes') or 'None'}

IMPORTANT BEHAVIOR:
- Greet them warmly by first name: "Hi {first_name}, good to hear from you!"
- Do NOT ask for their name or phone - you already have it
- You can reference past interactions if relevant
- If they have open tickets, mention them proactively
"""
    return context


def build_open_tickets_context(state: CallState) -> str:
    """Build context for caller's open tickets."""
    if not state.open_tickets:
        return ""

    lines = ["\n# CALLER'S OPEN TICKETS"]
    lines.append("This caller has open tickets. Offer to check on them or note if this call is about something new.\n")

    for t in state.open_tickets:
        lines.append(f"- Ticket #{t['id']}: {t['category'].upper()} - {t.get('issue_brief', 'No description')}")
        lines.append(f"  Status: {t['status']}, Priority: {t.get('priority', 'N/A')}")
        if t.get('assigned_to'):
            lines.append(f"  Assigned to: {t['assigned_to']}")
        if t.get('notes'):
            notes_preview = t['notes'][:100] + "..." if len(t['notes']) > 100 else t['notes']
            lines.append(f"  Latest note: {notes_preview}")
        lines.append("")

    lines.append("""
PROACTIVE OPTIONS:
- "I see you have an open service ticket for [issue]. Is this call about that, or something new?"
- If they ask about status: Tell them what you see above
- If they want to update: Note what they want changed
- If they want to cancel: Confirm and note the reason
""")

    return "\n".join(lines)


def build_known_info_context(state: CallState) -> str:
    """Build context for information already collected."""
    known = []

    if state.caller_name:
        known.append(f"- Caller name: {state.caller_name}")
    if state.caller_phone:
        known.append(f"- Callback number: {state.caller_phone}")
    if state.caller_company:
        known.append(f"- Company: {state.caller_company}")
    if state.caller_site:
        known.append(f"- Site: {state.caller_site}")

    # Add ticket fields
    current_ticket = state.get_current_ticket()
    for key, value in current_ticket.items():
        if value and key not in ['caller_name', 'caller_phone']:
            known.append(f"- {key.replace('_', ' ').title()}: {value}")

    if not known:
        return ""

    return f"""
# INFORMATION ALREADY COLLECTED
Don't ask for these again:
{chr(10).join(known)}
"""


def build_ticket_progress_context(state: CallState) -> str:
    """Build context showing current ticket progress."""
    current = state.get_current_ticket()
    if not current:
        return ""

    lines = [f"\n# CURRENT {state.department.upper()} TICKET PROGRESS"]
    for key, value in current.items():
        lines.append(f"- {key}: {value}")

    return "\n".join(lines)


def build_missing_fields_context(state: CallState) -> str:
    """Build prompt for missing required fields."""
    missing = get_missing_required_fields(state)
    if not missing:
        return ""

    # Prioritize what to ask next
    next_field = missing[0]

    return f"""
# STILL NEED TO COLLECT
Missing information: {', '.join(missing)}

ASK NEXT: {next_field}
(Ask naturally, one thing at a time. Don't list all missing fields to the caller.)
"""


def build_faq_context(state: CallState) -> str:
    """Build FAQ answer context if a question was detected."""
    if not state.faq_context:
        return ""

    return f"""
# FAQ ANSWER AVAILABLE
The caller asked a common question. Here's the answer to give them:

{state.faq_context}

Deliver this information naturally, then continue with whatever else they need.
"""


def build_prompt(state: CallState) -> str:
    """
    Build complete system prompt based on current call state.

    This version uses the actual prompt files from the multi-agent system.
    """
    sections = []

    # 1. Get the current department's prompt instruction
    dept_prompt = get_department_prompt(state.department)
    sections.append(dept_prompt)

    # 2. Customer context (if recognized)
    if state.is_recognized:
        customer_ctx = build_customer_context(state)
        if customer_ctx:
            sections.append(customer_ctx)

    # 3. Open tickets (if any)
    if state.open_tickets:
        tickets_ctx = build_open_tickets_context(state)
        if tickets_ctx:
            sections.append(tickets_ctx)

    # 4. Known caller info (don't re-ask)
    known_ctx = build_known_info_context(state)
    if known_ctx:
        sections.append(known_ctx)

    # 5. Current ticket progress
    progress_ctx = build_ticket_progress_context(state)
    if progress_ctx:
        sections.append(progress_ctx)

    # 6. Missing fields prompt (if not closing)
    if state.phase != "closing":
        missing_ctx = build_missing_fields_context(state)
        if missing_ctx:
            sections.append(missing_ctx)

    # 7. FAQ context (if question detected)
    faq_ctx = build_faq_context(state)
    if faq_ctx:
        sections.append(faq_ctx)

    return "\n".join(sections)


def build_prompt_short(state: CallState) -> str:
    """
    Build abbreviated system prompt.
    For the multi-agent system, this returns the same as build_prompt
    since prompts are already concise.
    """
    return build_prompt(state)
