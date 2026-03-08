# Privacy-First AI: Running LLMs Without Leaking Your Data

*Every API call sends your data to someone else's servers. Here's how to stop that.*

---

## The Problem: Data Leakage in API Calls

When you interact with cloud-based LLMs, your data travels to external servers. This means any sensitive information — Social Security Numbers, API keys, emails, internal IP addresses — can be exposed.

This isn't just a security risk. It's a compliance nightmare:
- **GDPR** requires explicit consent for data processing
- **HIPAA** mandates strict handling of health information
- **SOC2** demands audit trails for sensitive data access

And beyond compliance: **trust**. Your customers expect their data stays with you.

---

## Solution 1: Local Inference (The Obvious Answer)

The most straightforward way to avoid data leakage is to run the LLM yourself.

**Pros:**
- Complete data control
- No per-token costs
- No rate limits
- Zero network latency

**Cons:**
- Requires computational resources (GPU)
- Setup and maintenance overhead
- May not match frontier model quality (yet)

For many use cases, local inference is now viable. A single RTX 4090 can run 32B parameter models at interactive speeds. Two 3090s give you redundancy and parallel capacity.

**When local works:**
- Internal tools and workflows
- Customer-facing chat with acceptable quality requirements
- Document processing and analysis
- Code assistance

---

## Solution 2: Privacy Shield (When You MUST Use Cloud APIs)

Sometimes you need capabilities only cloud APIs provide. The Privacy Shield approach lets you use them securely:

### How It Works

```
[Your Data] → Intercept → Redact PII → Cloud API → Restore PII → [Safe Response]
```

1. **Intercept:** Catch API requests before they leave your network
2. **Redact:** Replace sensitive entities with placeholders (`John Smith` → `<PERSON_1>`)
3. **Forward:** Send sanitized request to the API
4. **Restore:** Put the original values back in the response

### What Gets Detected

**Built-in (via Presidio):**
- Names, emails, phone numbers
- Credit cards, SSNs, IBANs
- Dates, locations, addresses

**Custom recognizers:**
- API keys (OpenAI, Anthropic, GitHub, AWS, Azure, GCP)
- Tokens (Slack, Discord, JWT)
- Database connection strings
- Internal IPs (10.x, 172.16-31.x, 192.168.x)
- Internal hostnames (.local, .internal, .corp)

### Real Performance Numbers

From our production deployment:

| Metric | Value |
|--------|-------|
| Latency overhead | ~5.8ms per request |
| Throughput | 100+ req/s on modest hardware |
| Detection accuracy | 95%+ on common entity types |

The overhead is negligible compared to API round-trip times (200-500ms).

---

## Getting Started with Privacy Shield

### One-liner Docker Deploy

```bash
docker run -d -p 5000:5000 \
  -e LOCAL_LLM_URL=http://your-llm:8000 \
  ghcr.io/lightheartdevs/privacy-shield:latest
```

### Point Your Client at the Proxy

```bash
export OPENAI_BASE_URL=http://localhost:5000/v1
export OPENAI_API_KEY=anything  # Not used, but required by client
```

### Example: Python with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:5000/v1",
    api_key="not-used"
)

# This SSN will be redacted before hitting the API
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{
        "role": "user", 
        "content": "My SSN is 123-45-6789. What should I do with it?"
    }]
)

# Response has the SSN restored
print(response.choices[0].message.content)
```

### Example: LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:5000/v1",
    api_key="not-used",
    model="gpt-4"
)

# Email will be redacted in transit
response = llm.invoke("Email me at john@secret.com about the project")
```

---

## Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `LOCAL_LLM_URL` | `http://localhost:8000` | Backend LLM endpoint |
| `PRIVACY_MODE` | `on` | Enable/disable PII filtering |
| `MIN_PII_SCORE` | `0.4` | Confidence threshold (lower = more aggressive) |
| `PORT` | `5000` | Proxy listen port |

### Kill Switch

In emergencies, disable all API traffic immediately:

```bash
curl -X POST http://localhost:5000/kill
```

Re-enable:

```bash
curl -X POST http://localhost:5000/enable
```

---

## The Hybrid Approach

Most organizations will use both strategies:

| Workload | Approach |
|----------|----------|
| Internal tools, code assist | Local inference |
| Customer chat (standard) | Local inference |
| Complex reasoning, frontier tasks | Cloud API via Privacy Shield |
| Batch processing | Local inference |
| Real-time, high-volume | Local inference |

**The goal:** Minimize cloud API usage, maximize local. Use Privacy Shield as a safety net when cloud is unavoidable.

---

## Why This Matters

Data privacy isn't just about compliance. It's about:

1. **Trust:** Your customers chose you, not OpenAI or Anthropic
2. **Control:** You decide what happens to your data
3. **Cost:** Local inference has near-zero marginal cost
4. **Resilience:** No external dependencies, no outages you can't control

The AI industry is moving toward commoditization of inference. Open-weight models are catching up to closed ones. The question isn't *if* you'll run locally, but *when*.

Start now. Build the infrastructure. Be ready.

---

*Built by Android Labs — proving local-first AI works.*

*Privacy Shield: [GitHub](https://github.com/Lightheartdevs/Android-Labs/tree/main/products/privacy-shield) | [Docker](https://ghcr.io/lightheartdevs/privacy-shield)*
