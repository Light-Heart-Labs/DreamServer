# Privacy Shield 🛡️

[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Flightheartdevs%2Fprivacy--shield-blue)](https://ghcr.io/lightheartdevs/privacy-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**OpenAI-compatible API proxy with automatic PII filtering.**

Drop-in replacement for OpenAI API that routes through your local LLM while stripping sensitive data from prompts and restoring it in responses.

## What It Does

```
Your App → Privacy Shield → Local vLLM
             ↓
    Strip PII (SSN, API keys,
    emails, IPs, credentials...)
             ↓
      Forward to local LLM
             ↓
    Restore PII in response
             ↓
         ← Response
```

**Before:** "My SSN is 123-45-6789 and email john@acme.com"  
**Sent to LLM:** "My SSN is <US_SSN_1> and email <EMAIL_ADDRESS_1>"  
**Response from LLM:** "I see your SSN is <US_SSN_1>..."  
**Returned to app:** "I see your SSN is 123-45-6789..."

## Quick Start

### One-liner (from ghcr.io)

```bash
docker run -d -p 5000:5000 \
  -e LOCAL_LLM_URL=http://your-llm:8000 \
  ghcr.io/lightheartdevs/privacy-shield:latest
```

### Build locally

```bash
docker compose up -d
```

### Configure your client

```bash
export OPENAI_BASE_URL=http://localhost:5000/v1
export OPENAI_API_KEY=anything  # Not used, but required by client
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `LOCAL_LLM_URL` | `http://localhost:8000` | Your vLLM/local LLM endpoint |
| `PRIVACY_MODE` | `on` | Enable PII filtering (`on`/`off`) |
| `MIN_PII_SCORE` | `0.4` | Confidence threshold for detection |
| `PORT` | `5000` | Proxy port |

## What It Detects

**Built-in (Presidio):**
- Names, emails, phone numbers
- Credit cards, SSNs, IBANs
- Dates, locations

**Custom (extended):**
- OpenAI/Anthropic/GitHub API keys
- AWS/Azure/GCP credentials
- Slack/Discord tokens
- Private key headers
- JWT tokens
- Database connection strings
- Internal IPs (10.x, 172.16-31.x, 192.168.x)
- Internal hostnames (.local, .internal, .corp)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check + stats |
| `GET /stats` | Detailed statistics |
| `POST /v1/chat/completions` | Chat (with PII filtering) |
| `POST /v1/completions` | Legacy completions |
| `POST /v1/embeddings` | Embeddings |
| `GET /v1/models` | List models (passthrough) |
| `POST /kill` | Emergency kill switch |
| `POST /enable` | Re-enable after kill |

## Usage Examples

### curl

```bash
curl http://localhost:5000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-32B-Instruct-AWQ",
    "messages": [{"role": "user", "content": "My SSN is 123-45-6789. What is a SSN?"}]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:5000/v1",
    api_key="not-used"
)

response = client.chat.completions.create(
    model="Qwen/Qwen2.5-32B-Instruct-AWQ",
    messages=[
        {"role": "user", "content": "My API key is sk-abc123... is that safe?"}
    ]
)
```

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:5000/v1",
    api_key="not-used",
    model="Qwen/Qwen2.5-32B-Instruct-AWQ"
)

response = llm.invoke("Email me at john@secret.com about the project")
```

## Testing

```bash
# Run unit tests (requires Presidio)
pip install presidio-analyzer presidio-anonymizer
python -m spacy download en_core_web_lg
python test_shield.py
```

## Architecture

```
products/privacy-shield/
├── proxy.py              # Flask proxy with PII filtering
├── shield.py             # Core PII detection (Presidio wrapper)
├── custom_recognizers.py # Extended entity recognizers
├── test_shield.py        # Unit tests
├── Dockerfile            # Container build
├── docker-compose.yml    # Local dev setup
└── requirements.txt      # Python dependencies
```

## Kill Switch

If something goes wrong:

```bash
# Disable immediately
curl -X POST http://localhost:5000/kill

# Re-enable
curl -X POST http://localhost:5000/enable
```

## Real-World Use Cases

**1. Dev team with local LLM:**  
Point your IDE's Copilot-style extension at Privacy Shield → code completions use your local Qwen/Llama without leaking proprietary code.

**2. Enterprise compliance:**  
SOC2/HIPAA environments can use AI tooling without risk of PII exfiltration. Kill switch for incident response.

**3. CI/CD pipelines:**  
Let your build system ask an LLM about errors while auto-scrubbing secrets from logs before they leave your network.

**4. Customer support:**  
Route support chat through an LLM for suggestions while ensuring customer emails/IDs never hit third-party APIs.

## Performance

- **Latency overhead:** ~5.8ms per request
- **Throughput:** Handles 100+ req/s on modest hardware
- **Memory:** ~200MB container footprint

## Mission

**M3: API Privacy Shield** — Programs that let you use AI APIs while shielding sensitive data, recombining results locally.

Part of [Android-Labs](https://github.com/Lightheartdevs/Android-Labs) — AI infrastructure for the self-hosting community.
