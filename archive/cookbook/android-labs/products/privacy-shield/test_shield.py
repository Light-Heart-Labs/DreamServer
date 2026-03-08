#!/usr/bin/env python3
"""
Unit tests for Privacy Shield PII detection.
Run without Docker: python test_shield.py
Requires: pip install presidio-analyzer presidio-anonymizer && python -m spacy download en_core_web_lg

SECURITY NOTE: This file contains intentionally FAKE secrets (API keys, tokens, credentials)
for testing PII detection. These are NOT real secrets - they are test fixtures designed
to verify that Privacy Shield correctly identifies and scrubs sensitive patterns.
- sk-proj-abc123... = Fake OpenAI key
- ghp_aBcDeFg... = Fake GitHub PAT
- AKIAIOSFODNN7EXAMPLE = Standard AWS example key
- eyJhbGciOiJIUzI1NiIs... = Fake JWT token
If running automated secret scanners, exclude this file or mark findings as false positives.
"""
import sys

# Test cases: (input, expected_entity_types, description)
TEST_CASES = [
    # SSN detection
    (
        "My SSN is 123-45-6789",
        ["US_SSN"],
        "SSN with dashes"
    ),
    # Email
    (
        "Contact me at john.doe@example.com",
        ["EMAIL_ADDRESS"],
        "Email address"
    ),
    # API Keys
    (
        "Use this key: sk-proj-abc123def456xyz789abcdef",
        ["API_KEY"],
        "OpenAI API key"
    ),
    (
        "The token is ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
        ["API_KEY"],
        "GitHub PAT"
    ),
    # AWS
    (
        "Access key: AKIAIOSFODNN7EXAMPLE",
        ["CLOUD_CREDENTIAL"],
        "AWS access key"
    ),
    # Internal IPs
    (
        "Connect to 192.168.1.100 for the database",
        ["INTERNAL_IP"],
        "Internal IP address"
    ),
    # Connection strings
    (
        "postgres://admin:secret123@db.internal:5432/mydb",
        ["CONNECTION_STRING"],
        "Database connection string"
    ),
    # JWT
    (
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        ["JWT_TOKEN"],
        "JWT token"
    ),
    # Private key header
    (
        "-----BEGIN RSA PRIVATE KEY-----",
        ["PRIVATE_KEY"],
        "RSA private key header"
    ),
    # Combined
    (
        "Email john@acme.com, SSN 555-12-1234, use key sk-abc123456789012345678901234567890",
        ["EMAIL_ADDRESS", "US_SSN", "API_KEY"],
        "Multiple PII types"
    ),
]


def run_tests():
    """Run all test cases."""
    try:
        from shield import shield, unshield
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Install dependencies: pip install presidio-analyzer presidio-anonymizer")
        print("Then: python -m spacy download en_core_web_lg")
        return False
    
    passed = 0
    failed = 0
    
    print("=" * 60)
    print("Privacy Shield Unit Tests")
    print("=" * 60)
    
    for i, (input_text, expected_types, description) in enumerate(TEST_CASES, 1):
        print(f"\nTest {i}: {description}")
        print(f"  Input: {input_text[:60]}{'...' if len(input_text) > 60 else ''}")
        
        try:
            anonymized, mapping, latency = shield(input_text)
            
            # Check that expected entities were detected
            detected_types = set()
            for placeholder in mapping.keys():
                # Extract entity type from <ENTITY_TYPE_N>
                entity_type = '_'.join(placeholder.strip('<>').split('_')[:-1])
                detected_types.add(entity_type)
            
            missing = set(expected_types) - detected_types
            
            if missing:
                print(f"  ❌ FAIL: Missing entity types: {missing}")
                print(f"     Got: {detected_types}")
                print(f"     Anonymized: {anonymized}")
                failed += 1
            else:
                print(f"  ✅ PASS ({latency:.1f}ms)")
                print(f"     Detected: {detected_types}")
                
                # Test round-trip
                restored = unshield(anonymized, mapping)
                if restored != input_text:
                    print(f"  ⚠️  Round-trip mismatch!")
                    print(f"     Original:  {input_text}")
                    print(f"     Restored:  {restored}")
                    failed += 1
                else:
                    passed += 1
                    
        except Exception as e:
            print(f"  ❌ ERROR: {e}")
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0


def test_latency():
    """Benchmark PII detection latency."""
    try:
        from shield import shield
    except ImportError:
        return
    
    import time
    
    test_text = """
    Hello, I'm John Smith (john.smith@example.com). 
    My SSN is 123-45-6789 and I work at 192.168.1.50.
    API key: sk-abc123456789012345678901234567890
    Connect to postgres://admin:password@db.internal:5432/app
    """
    
    # Warm up
    shield(test_text)
    
    # Benchmark
    iterations = 10
    start = time.perf_counter()
    for _ in range(iterations):
        shield(test_text)
    elapsed = (time.perf_counter() - start) * 1000
    
    print(f"\nLatency benchmark: {elapsed/iterations:.1f}ms per call ({iterations} iterations)")


if __name__ == "__main__":
    success = run_tests()
    test_latency()
    sys.exit(0 if success else 1)
