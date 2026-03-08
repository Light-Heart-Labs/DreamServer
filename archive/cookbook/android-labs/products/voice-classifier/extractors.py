"""
Entity Extractors for M4 Deterministic Voice Agents

Centralized extractor functions for common entity types.
Used by FSM for slot filling during conversation flows.

Extractors return captured values or None if no match found.
"""

import re
from typing import Dict, Optional, Callable, Any


class Extractor:
    """Base extractor class with .extract() method for registry pattern."""
    
    def extract(self, text: str) -> Optional[Any]:
        """Extract value from text. Override in subclasses."""
        raise NotImplementedError


def extract_date(text: str) -> Optional[str]:
    """Extract date from text."""
    # Common patterns
    patterns = [
        (r'tomorrow', 'tomorrow'),
        (r'today', 'today'),
        (r'next week', 'next_week'),
        (r'monday|tuesday|wednesday|thursday|friday|saturday|sunday', None),  # Returns full match via group(0)
    ]
    
    text_lower = text.lower()
    
    for pattern, value in patterns:
        match = re.search(pattern, text_lower)
        if match:
            if value:
                return value
            # Return the matched text (full match, or first capture group if using groups)
            return match.group(0)
    
    return None


def extract_time_preference(text: str) -> Optional[str]:
    """Extract time preference from text."""
    text_lower = text.lower()
    
    if 'morning' in text_lower:
        return 'morning'
    elif 'afternoon' in text_lower:
        return 'afternoon'
    elif 'evening' in text_lower:
        return 'evening'
    
    return None


def extract_name(text: str) -> Optional[str]:
    """Extract name from text (simple heuristic)."""
    # Look for "my name is X" or "I'm X" or "this is X"
    
    patterns = [
        r'my name is (\w+)',
        r"i'm (\w+)",
        r'this is (\w+)',
        r'^(\w+) speaking',
    ]
    
    text_lower = text.lower()
    
    for pattern in patterns:
        match = re.search(pattern, text_lower)
        if match:
            return match.group(1).capitalize()
    
    return None


def extract_phone(text: str) -> Optional[str]:
    """Extract phone number from text."""
    # Match various phone formats
    patterns = [
        r'\b(\d{3}[-.]?\d{3}[-.]?\d{4})\b',  # 123-456-7890, 123.456.7890, 1234567890
        r'\b\((\d{3})\)\s*(\d{3}[-.]?\d{4})\b',  # (123) 456-7890
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            # Return normalized format
            parts = match.groups()
            if len(parts) == 2:
                return f"({parts[0]}) {parts[1]}"
            return parts[0]
    
    return None


def extract_email(text: str) -> Optional[str]:
    """Extract email address from text."""
    pattern = r'\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b'
    
    match = re.search(pattern, text)
    if match:
        return match.group(1)
    
    return None


def extract_yes_no(text: str) -> Optional[bool]:
    """Extract yes/no answer from text."""
    text_lower = text.lower().strip()
    
    # Yes answers
    yes_patterns = [
        r'^yes$',
        r'^yes,? (i[\'sx] |[a-z]+ )?sure$',
        r'^ya$',
        r'^yeah$',
        r'^yep$',
        r'^yeah,? (that|this) ([a-z]+ )?sure$',
        r'^correct$',
        r'^that[\'sx]? right$',
        r'^absolutely$',
        r'^definitely$',
        r'^yes please$',
    ]
    
    for pattern in yes_patterns:
        if re.search(pattern, text_lower):
            return True
    
    # No answers
    no_patterns = [
        r'^no$',
        r'^no,? (i[\'sx] |[a-z]+ )?think$',
        r'^no,? (that|this) ([a-z]+ )?right$',
        r'^nah$',
        r'^nope$',
        r'^never$',
        r'^no thank(s?| you)$',
        r'^cancel$',
        r'^cancel(ing|ed)?$',
    ]
    
    for pattern in no_patterns:
        if re.search(pattern, text_lower):
            return False
    
    return None


def extract_time(text: str) -> Optional[str]:
    """Extract time from text."""
    # Match various time formats
    patterns = [
        r'\b((?:0[1-9]|1[0-2]):[0-5][0-9]\s*(?:AM|PM|am|pm)?)\b',  # 12:30 PM
        r'\b((?:0[1-9]|1[0-2])\s*(?:AM|PM|am|pm))\b',  # 12 PM
        r'\b([0-2][0-9]:[0-5][0-9])\b',  # 24-hour format
        r'\b((?:morning|afternoon|evening|night))\b',  # Time of day
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    
    return None


def extract_number(text: str) -> Optional[int]:
    """Extract integer from text."""
    pattern = r'\b(\d+)\b'
    
    match = re.search(pattern, text)
    if match:
        return int(match.group(1))
    
    return None


def extract_url(text: str) -> Optional[str]:
    """Extract URL from text."""
    pattern = r'\b(https?://[^\s]+)\b'
    
    match = re.search(pattern, text)
    if match:
        return match.group(1)
    
    return None


def extract_money(text: str) -> Optional[str]:
    """Extract monetary amount from text."""
    # Match various currency formats
    patterns = [
        r'\$([\d,]+(?:\.\d{2})?)',  # $1,234.56
        r'(\d+(?:\.\d{2})?)\s*dollars?',  # 123.45 dollars
        r'([\d,]+(?:\.\d{2})?)\s*USD',  # 1,234.56 USD
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # Return the amount (first capture group)
            return match.group(1)
    
    return None


# ── Registry Pattern: Extractor Classes ──────────────────────────────────────

class DateExtractor(Extractor):
    """Date extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_date(text)


class TimePreferenceExtractor(Extractor):
    """Time preference extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_time_preference(text)


class NameExtractor(Extractor):
    """Name extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_name(text)


class PhoneExtractor(Extractor):
    """Phone extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_phone(text)


class EmailExtractor(Extractor):
    """Email extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_email(text)


class YesNoExtractor(Extractor):
    """Yes/No extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[bool]:
        return extract_yes_no(text)


class TimeExtractor(Extractor):
    """Time extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_time(text)


class NumberExtractor(Extractor):
    """Number extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[int]:
        return extract_number(text)


class UrlExtractor(Extractor):
    """URL extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_url(text)


class MoneyExtractor(Extractor):
    """Money extractor with .extract() method."""
    
    def extract(self, text: str) -> Optional[str]:
        return extract_money(text)


# ── Convenience Function: get_extractor() ────────────────────────────────────

def get_extractor(entity_type: str) -> Optional[Extractor]:
    """Get extractor instance by entity type.
    
    Args:
        entity_type: One of: date, time_preference, name, phone, email,
                     yes_no, time, number, url, money
    
    Returns:
        Extractor instance with .extract() method, or None if not found.
    """
    extractors = {
        "date": DateExtractor(),
        "time_preference": TimePreferenceExtractor(),
        "name": NameExtractor(),
        "phone": PhoneExtractor(),
        "email": EmailExtractor(),
        "yes_no": YesNoExtractor(),
        "time": TimeExtractor(),
        "number": NumberExtractor(),
        "url": UrlExtractor(),
        "money": MoneyExtractor(),
    }
    return extractors.get(entity_type)


# ── Default extractors registry (backward compatible) ────────────────────────
# Still provides direct function references for existing code
DEFAULT_EXTRACTORS: Dict[str, Callable[[str], Optional[Any]]] = {
    "date": extract_date,
    "time_preference": extract_time_preference,
    "name": extract_name,
    "phone": extract_phone,
    "email": extract_email,
    "yes_no": extract_yes_no,
    "time": extract_time,
    "number": extract_number,
    "url": extract_url,
    "money": extract_money,
}
