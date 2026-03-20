#!/usr/bin/env python3
"""
M3: API Privacy Shield - Core PII Scrubber
Detects and replaces PII with tokens, restores on reverse.
"""

import re
import hashlib
import secrets
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field


@dataclass
class PIIDetector:
    """Detects and manages PII in text."""
    
    # Token prefix for PII placeholders
    token_prefix: str = "<PII_"
    token_suffix: str = ">"
    
    # Session-specific PII mappings (persistent per conversation)
    pii_map: Dict[str, str] = field(default_factory=dict)
    counter: int = field(default=0)
    
    # Stable session token (persisted, doesn't change on restart)
    session_token: str = field(default_factory=lambda: secrets.token_hex(16))
    
    # Regex patterns for PII detection
    PATTERNS = {
        'email': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
        'phone': re.compile(r'\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b'),
        'ssn': re.compile(r'\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b'),
        'ip_address': re.compile(
            r'\b(?:\d{1,3}\.){3}\d{1,3}\b'  # IPv4
            r'|'
            r'(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}'  # Full IPv6
            r'|'
            r'(?:[0-9a-fA-F]{1,4}:){1,7}:'  # Trailing ::
            r'|'
            r'::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}'  # Leading ::
            r'|'
            r'(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}'  # Middle ::
        ),
        'api_key': re.compile(r'\b(?:api[_-]?key|apikey|token)[\s]*[=:]\s*["\']?[a-zA-Z0-9_\-]{16,}["\']?\b', re.IGNORECASE),
        'credit_card': re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'),
    }
    
    def _generate_token(self, pii_type: str, original: str) -> str:
        """Generate a unique token for PII."""
        # Create deterministic hash for same PII = same token within session
        # Use stable session_token instead of id(self) which changes on restart
        hash_input = f"{pii_type}:{original}:{self.session_token}"
        short_hash = hashlib.sha256(hash_input.encode()).hexdigest()[:12]
        return f"{self.token_prefix}{pii_type}_{short_hash}{self.token_suffix}"
    
    def scrub(self, text: str) -> str:
        """
        Scrub PII from text, replace with tokens.
        Returns scrubbed text.
        """
        scrubbed = text
        
        for pii_type, pattern in self.PATTERNS.items():
            matches = pattern.findall(scrubbed)
            for match in matches:
                if isinstance(match, tuple):
                    match = match[0]  # Handle groups
                
                # Check if we've seen this PII before
                existing_token = None
                for token, original in self.pii_map.items():
                    if original == match:
                        existing_token = token
                        break
                
                if existing_token:
                    scrubbed = scrubbed.replace(match, existing_token, 1)
                else:
                    # New PII - create token
                    token = self._generate_token(pii_type, match)
                    self.pii_map[token] = match
                    scrubbed = scrubbed.replace(match, token, 1)
        
        return scrubbed
    
    def restore(self, text: str) -> str:
        """
        Restore PII from tokens in text.
        Returns restored text.
        """
        restored = text
        for token, original in self.pii_map.items():
            restored = restored.replace(token, original)
        return restored
    
    def get_stats(self) -> Dict:
        """Return statistics about detected PII."""
        return {
            'unique_pii_count': len(self.pii_map),
            'pii_types': list(set(
                token.split('_')[1] for token in self.pii_map.keys()
            ))
        }


class PrivacyShield:
    """
    Main API Privacy Shield wrapper.
    Wraps API calls to scrub/restore PII transparently.
    """
    
    def __init__(self, backend_client=None):
        self.detector = PIIDetector()
        self.backend = backend_client  # e.g., OpenAI client
    
    def process_request(self, prompt: str) -> Tuple[str, Dict]:
        """
        Process outgoing request - scrub PII.
        Returns (scrubbed_prompt, metadata for restore).
        """
        scrubbed = self.detector.scrub(prompt)
        stats = self.detector.get_stats()
        
        metadata = {
            'scrubbed': scrubbed != prompt,
            'pii_count': stats['unique_pii_count'],
            'pii_types': stats['pii_types']
        }
        
        return scrubbed, metadata
    
    def process_response(self, response_text: str) -> str:
        """
        Process incoming response - restore PII.
        """
        return self.detector.restore(response_text)


# Simple CLI for testing
if __name__ == "__main__":
    import sys
    
    shield = PrivacyShield()
    
    # Test input
    test_text = """
    Contact John Doe at john.doe@example.com or call 555-123-4567.
    API Key: sk-abc123xyz789abcdef
    Server IP: 192.168.1.100
    SSN: 123-45-6789
    """
    
    print("=== PII Scrubber Test ===")
    print(f"\nOriginal:\n{test_text}")
    
    scrubbed, meta = shield.process_request(test_text)
    print(f"\nScrubbed:\n{scrubbed}")
    print(f"\nMetadata: {meta}")
    
    restored = shield.process_response(scrubbed)
    print(f"\nRestored:\n{restored}")
    
    # Verify round-trip
    if restored.strip() == test_text.strip():
        print("\n✅ Round-trip successful!")
    else:
        print("\n❌ Round-trip failed!")
        print(f"Diff: {set(restored.split()) ^ set(test_text.split())}")
