# Recipe 4: Privacy-Preserving API Proxy

*Local AI Cookbook | 2026-02-09*

A practical guide for building an API proxy that strips sensitive data before sending to cloud AI.

---

## Use Case

Organizations that need to:
- Use cloud AI APIs (OpenAI, Anthropic, etc.)
- Protect sensitive data (PII, credentials, internal info)
- Maintain compliance (GDPR, HIPAA, etc.)

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Proxy     │────▶│  Cloud API  │
│   Request   │     │ (anonymize) │     │  (OpenAI)   │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                          │                    │
                    ┌─────▼─────┐        ┌─────▼─────┐
                    │  Entity   │        │  Response │
                    │  Mapping  │◀───────│  (raw)    │
                    └───────────┘        └───────────┘
                          │
                    ┌─────▼─────┐
                    │ Deanon-   │
                    │ ymize     │
                    └─────┬─────┘
                          │
                    ┌─────▼─────┐
                    │ Client    │
                    │ Response  │
                    └───────────┘
```

---

## Entity Detection Approaches

### 1. Regex (simple, fast)

```python
import re

PATTERNS = {
    "email": r"[\w.-]+@[\w.-]+\.\w+",
    "phone": r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b",
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "credit_card": r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",
    "ip_address": r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
}

def detect_with_regex(text):
    entities = []
    for entity_type, pattern in PATTERNS.items():
        for match in re.finditer(pattern, text):
            entities.append({
                "text": match.group(),
                "type": entity_type,
                "start": match.start(),
                "end": match.end()
            })
    return entities
```

### 2. Presidio (comprehensive, production-ready)

```python
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

def detect_with_presidio(text, language="en"):
    results = analyzer.analyze(text=text, language=language)
    return [
        {"text": text[r.start:r.end], "type": r.entity_type, 
         "start": r.start, "end": r.end, "score": r.score}
        for r in results
    ]
```

### 3. spaCy NER (names, organizations, locations)

```python
import spacy
nlp = spacy.load("en_core_web_sm")

def detect_with_spacy(text):
    doc = nlp(text)
    return [
        {"text": ent.text, "type": ent.label_, 
         "start": ent.start_char, "end": ent.end_char}
        for ent in doc.ents
    ]
```

---

## Anonymization Strategies

### Redaction (simple)
```python
def redact(text, entities):
    for entity in sorted(entities, key=lambda x: x["start"], reverse=True):
        text = text[:entity["start"]] + f"[{entity['type']}]" + text[entity["end"]:]
    return text
```

### Pseudonymization (reversible)
```python
import hashlib

def pseudonymize(text, entities, mapping=None):
    if mapping is None:
        mapping = {}
    
    for entity in sorted(entities, key=lambda x: x["start"], reverse=True):
        original = entity["text"]
        if original not in mapping:
            pseudo = f"ENTITY_{len(mapping):04d}"
            mapping[original] = pseudo
        text = text[:entity["start"]] + mapping[original] + text[entity["end"]:]
    
    return text, mapping

def deanonymize(text, mapping):
    reverse_mapping = {v: k for k, v in mapping.items()}
    for pseudo, original in reverse_mapping.items():
        text = text.replace(pseudo, original)
    return text
```

---

## Complete Proxy Implementation

```python
from flask import Flask, request, jsonify
import requests
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

app = Flask(__name__)
analyzer = AnalyzerEngine()

# Session storage for multi-turn
sessions = {}

@app.route("/v1/chat/completions", methods=["POST"])
def proxy_chat():
    data = request.json
    session_id = request.headers.get("X-Session-ID", "default")
    
    # Get or create session mapping
    if session_id not in sessions:
        sessions[session_id] = {}
    mapping = sessions[session_id]
    
    # Anonymize messages
    anonymized_messages = []
    for msg in data["messages"]:
        anon_content, mapping = pseudonymize_with_presidio(
            msg["content"], mapping
        )
        anonymized_messages.append({
            "role": msg["role"],
            "content": anon_content
        })
    
    # Update session
    sessions[session_id] = mapping
    
    # Forward to real API
    data["messages"] = anonymized_messages
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json=data
    )
    
    # Deanonymize response
    result = response.json()
    if "choices" in result:
        for choice in result["choices"]:
            choice["message"]["content"] = deanonymize(
                choice["message"]["content"], mapping
            )
    
    return jsonify(result)

def pseudonymize_with_presidio(text, mapping):
    results = analyzer.analyze(text=text, language="en")
    
    # Sort by position (reverse) for safe replacement
    for r in sorted(results, key=lambda x: x.start, reverse=True):
        original = text[r.start:r.end]
        if original not in mapping:
            mapping[original] = f"[{r.entity_type}_{len(mapping):04d}]"
        text = text[:r.start] + mapping[original] + text[r.end:]
    
    return text, mapping

if __name__ == "__main__":
    app.run(port=8085)
```

---

## Performance Considerations

| Stage | Latency | Optimization |
|-------|---------|--------------|
| Entity detection | 10-50ms | Use regex for simple patterns |
| Anonymization | 1-5ms | In-memory string ops |
| API call | 500-2000ms | This is the bottleneck |
| Deanonymization | 1-5ms | Cache reverse mappings |

**Total overhead:** ~15-60ms (negligible vs API latency)

---

## Security Best Practices

1. **Never log original data** — Only log anonymized versions
2. **Encrypt mapping storage** — Session mappings are sensitive
3. **Use TLS** — All communication encrypted
4. **Audit access** — Log who accesses what, when
5. **Rotate session mappings** — Don't reuse indefinitely
6. **Validate inputs** — Prevent injection attacks

---

## Custom Entity Types

Add domain-specific patterns:

```python
# HVAC-specific entities
CUSTOM_PATTERNS = {
    "service_order": r"SO-\d{6,8}",
    "customer_id": r"CID-\d{4,6}",
    "equipment_serial": r"[A-Z]{3}\d{8,12}",
}

# API keys
API_KEY_PATTERNS = {
    "openai_key": r"sk-[a-zA-Z0-9]{48}",
    "anthropic_key": r"sk-ant-[a-zA-Z0-9-]{95}",
    "github_token": r"gh[ps]_[a-zA-Z0-9]{36}",
}
```

---

## Light Heart Cluster Implementation

Our production implementation includes extended recognizers:
- 15 additional entity types (API keys, cloud credentials, internal IPs)
- Session-based multi-turn conversation support
- Security audit and documentation

**Files:** `research/API-PRIVACY-SHIELD.md`, `extended_recognizers.py`

---

*This recipe is part of the Local AI Cookbook — practical guides for self-hosted AI systems.*
