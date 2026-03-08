# M3 PII Detection Libraries for API Privacy Shield

*Research for local-first PII detection/redaction (2026-02-10)*

## Python Libraries

### 1. Microsoft Presidio ⭐ (Recommended)
- Part of Azure AI services but runs fully local
- Powerful analyzer + anonymizer pattern
- Well-documented, actively maintained

```python
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

text = "Contact john@company.com or call (555) 123-4567"
results = analyzer.analyze(text=text, language='en')
anonymized_text = anonymizer.anonymize(text=text, analyzer_results=results)
```

### 2. DataFog 🚀 (Fast)
- Performance-optimized for high throughput
- Good for API interception use case

```python
from datafog import DataFog

df = DataFog()
text = "My SSN is 123-45-6789"
redacted = df.process_text(text, operations=["scan", "redact"])
```

### 3. spaCy NER
- General-purpose NER, not PII-specific
- Can be trained for custom entity types
- Good fallback option

```python
import spacy

nlp = spacy.load("en_core_web_sm")
doc = nlp(text)
for ent in doc.ents:
    print(ent.text, ent.label_)
```

### 4. Sanityze
- Simple package for basic PII removal
- Less configurable but easy to use

### 5. AWS Comprehend
- Cloud-based (not local-first)
- Listed for completeness, NOT recommended for M3

## Simplest Proxy Architecture

Flask-based interceptor:

```python
from flask import Flask, request, jsonify
import requests
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

app = Flask(__name__)
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

def redact_pii(text):
    results = analyzer.analyze(text=text, language='en')
    return anonymizer.anonymize(text=text, analyzer_results=results).text

@app.route('/v1/chat/completions', methods=['POST'])
def proxy():
    data = request.json
    
    # Redact PII from messages
    for msg in data.get('messages', []):
        if 'content' in msg:
            msg['content'] = redact_pii(msg['content'])
    
    # Forward to real API
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        json=data,
        headers={'Authorization': request.headers.get('Authorization')}
    )
    
    return jsonify(response.json())

if __name__ == '__main__':
    app.run(port=8080)
```

## Minimal Viable Implementation

1. **Proxy server** (Flask/FastAPI)
2. **PII detection** (Presidio — best balance of accuracy + local)
3. **Request interception** (modify messages before forward)
4. **Response passthrough** (no modification needed on responses)

## Recommendation for M3

Use **Microsoft Presidio** as the PII engine:
- Fully local (no cloud dependency)
- Accurate entity recognition
- Configurable redaction strategies
- Apache 2.0 license

Pair with **FastAPI** for the proxy (async, better performance than Flask).

---

*Source: Sub-agent research (m3-pii-research)*
