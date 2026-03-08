#!/usr/bin/env python3
"""
API Privacy Shield - Phase 1 PoC
Strips PII from text, returns anonymized version + mapping for later restoration.
"""

import time
from typing import Tuple, Dict, List
from collections import defaultdict

from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_anonymizer import AnonymizerEngine

# Import custom recognizers
from custom_recognizers import get_custom_recognizers

# Initialize engines (cached for reuse)
_analyzer = None
_anonymizer = None

def get_engines():
    global _analyzer, _anonymizer
    if _analyzer is None:
        _analyzer = AnalyzerEngine()
        # Add custom recognizers
        for recognizer in get_custom_recognizers():
            _analyzer.registry.add_recognizer(recognizer)
        _anonymizer = AnonymizerEngine()
    return _analyzer, _anonymizer

# Entity types to detect - includes both built-in and custom
ENTITIES = [
    # Built-in Presidio entities
    "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER",
    "CREDIT_CARD", "US_SSN", "IBAN_CODE",
    "IP_ADDRESS", "DATE_TIME",
    "US_DRIVER_LICENSE", "LOCATION",
    # Custom entities
    "FILENAME_WITH_NAME",
    "API_KEY",
    "CLOUD_CREDENTIAL",
    "PRIVATE_KEY",
    "JWT_TOKEN",
    "CONNECTION_STRING",
    "PASSWORD_IN_URL",
    "INTERNAL_IP",
    "INTERNAL_HOSTNAME",
]

def remove_overlaps(results: List[RecognizerResult]) -> List[RecognizerResult]:
    """Remove overlapping entities, keeping higher confidence ones."""
    if not results:
        return []
    
    # Sort by score descending, then by length descending
    sorted_results = sorted(results, key=lambda x: (-x.score, -(x.end - x.start)))
    
    kept = []
    for result in sorted_results:
        overlaps = False
        for kept_result in kept:
            # Check overlap
            if not (result.end <= kept_result.start or result.start >= kept_result.end):
                overlaps = True
                break
        if not overlaps:
            kept.append(result)
    
    return kept


def shield(text: str, min_score: float = 0.4) -> Tuple[str, Dict[str, str], float]:
    """
    Anonymize PII in text with indexed placeholders.
    
    Returns:
        - anonymized_text: Text with <ENTITY_N> placeholders
        - mapping: Dict mapping placeholders to original values
        - latency_ms: Processing time in milliseconds
    """
    start = time.perf_counter()
    
    analyzer, anonymizer = get_engines()
    
    # Analyze
    results = analyzer.analyze(
        text=text, 
        language="en",
        entities=ENTITIES,
        score_threshold=min_score
    )
    
    # Remove overlapping entities (keep higher confidence)
    results = remove_overlaps(results)
    
    # Sort by position for indexed replacement
    results = sorted(results, key=lambda x: x.start)
    
    # Build indexed placeholders - count in FORWARD order so indices match text position
    entity_counts = defaultdict(int)
    placeholders = []  # Store (start, end, placeholder, original_value)
    
    for result in results:
        entity_type = result.entity_type
        entity_counts[entity_type] += 1
        idx = entity_counts[entity_type]
        
        original_value = text[result.start:result.end]
        placeholder = f"<{entity_type}_{idx}>"
        placeholders.append((result.start, result.end, placeholder, original_value))
    
    # Build mapping
    mapping = {p[2]: p[3] for p in placeholders}
    
    # Replace from end to preserve positions (but indices already assigned in forward order)
    anonymized = text
    for start, end, placeholder, _ in reversed(placeholders):
        anonymized = anonymized[:start] + placeholder + anonymized[end:]
    
    latency_ms = (time.perf_counter() - start) * 1000
    
    return anonymized, mapping, latency_ms


def unshield(text: str, mapping: Dict[str, str]) -> str:
    """Restore original PII values from mapping."""
    result = text
    for placeholder, original in mapping.items():
        result = result.replace(placeholder, original)
    return result


if __name__ == "__main__":
    # Quick test
    test = "My SSN is 123-45-6789 and file john_smith_resume.pdf"
    anonymized, mapping, latency = shield(test)
    print(f"Input: {test}")
    print(f"Output: {anonymized}")
    print(f"Mapping: {mapping}")
    print(f"Latency: {latency:.1f}ms")
