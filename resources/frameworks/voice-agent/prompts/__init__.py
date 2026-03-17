# HVAC Grace Multi-Agent Prompts
# Each specialist has a focused domain-specific prompt
# Categories match dashboard/database: service, maintenance, projects, controls, billing, parts, general

from .shared import GRACE_IDENTITY, CONVERSATION_CONTINUITY
from .portal import PORTAL_INSTRUCTION
from .service import SERVICE_INSTRUCTION
from .parts import PARTS_INSTRUCTION
from .billing import BILLING_INSTRUCTION
from .projects import PROJECTS_INSTRUCTION
from .maintenance import MAINTENANCE_INSTRUCTION
from .controls import CONTROLS_INSTRUCTION
from .office import OFFICE_INSTRUCTION  # Maps to "general" category
from .closing import CLOSING_SEQUENCE, CLOSING_INSTRUCTION

__all__ = [
    'GRACE_IDENTITY',
    'CONVERSATION_CONTINUITY',
    'PORTAL_INSTRUCTION',
    'SERVICE_INSTRUCTION',
    'PARTS_INSTRUCTION',
    'BILLING_INSTRUCTION',
    'PROJECTS_INSTRUCTION',
    'MAINTENANCE_INSTRUCTION',
    'CONTROLS_INSTRUCTION',
    'OFFICE_INSTRUCTION',
    'CLOSING_SEQUENCE',
    'CLOSING_INSTRUCTION',
]
