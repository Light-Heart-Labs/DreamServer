# Agent Security: Network Protection and Injection Defense

Best practices for preventing SSRF attacks and hidden prompt injection via Unicode manipulation in autonomous AI agent systems. Derived from production analysis of agentic tools processing millions of network requests and tool inputs daily.

*Last updated: 2026-03-31*

---

## Why This Matters

AI agents that make HTTP requests or process text from untrusted sources face two critical attack surfaces:

1. **SSRF (Server-Side Request Forgery):** An agent tricked into making requests to internal services, cloud metadata endpoints, or private networks
2. **Hidden prompt injection:** Invisible Unicode characters that embed malicious instructions in seemingly normal text

Both attacks exploit the gap between what humans see and what the system processes. Production agent systems must defend against both.

---

## Part 1: SSRF Protection

### 1.1 The Threat Model

When an agent can make HTTP requests (via hooks, MCP servers, tool calls, or web fetching), an attacker can craft inputs that cause the agent to:

- Hit cloud metadata endpoints (`169.254.169.254`) to steal credentials
- Access internal services on private networks (`10.x.x.x`, `192.168.x.x`)
- Reach CGNAT/shared address space endpoints (`100.64.0.0/10`) used by some cloud providers for metadata
- Probe localhost services to map the host machine
- Exfiltrate data to attacker-controlled servers

### 1.2 IP Range Blocking

Block requests to these ranges by default:

| Range | CIDR | Why |
|-------|------|-----|
| This network | `0.0.0.0/8` | RFC 1122 — should never be a destination |
| Private (Class A) | `10.0.0.0/8` | Internal network |
| Shared/CGNAT | `100.64.0.0/10` | Carrier NAT — covers cloud metadata like Alibaba's `100.100.100.200` |
| Link-local | `169.254.0.0/16` | AWS/GCP/Azure metadata endpoint lives here |
| Private (Class B) | `172.16.0.0/12` | Internal network |
| Private (Class C) | `192.168.0.0/16` | Internal network |

#### IPv6 Equivalents

| Range | CIDR | Why |
|-------|------|-----|
| Unspecified | `::` | Should never be a destination |
| Unique Local | `fc00::/7` | IPv6 private network equivalent |
| Link-Local | `fe80::/10` | IPv6 link-local equivalent |
| IPv4-Mapped | `::ffff:<blocked-v4>` | IPv4 addresses embedded in IPv6 — must extract and check the v4 part |

#### Intentional Exceptions

| Range | CIDR | Why Allow |
|-------|------|-----------|
| Loopback | `127.0.0.0/8` | Local development servers (MCP, dev tools) |
| IPv6 Loopback | `::1` | Same |

**Key Insight:** Blocking loopback breaks local development. Allow it, but document the risk. For production deployments, consider blocking loopback too and using explicit allowlists for known local services.

### 1.3 DNS Rebinding Prevention

**The attack:** An attacker controls a DNS server that first resolves `evil.com` to a public IP (passing validation), then on the actual connection resolves to `169.254.169.254` (cloud metadata).

**The fix:** Validate the IP address at **socket connect time**, not at request time.

```
WRONG: resolve DNS -> check IP -> make connection (rebinding window exists)
RIGHT: make connection with custom DNS lookup -> check IP in lookup callback -> allow/deny
```

**Implementation approach:** Use your HTTP library's `lookup` or `dns` hook to intercept DNS resolution and validate the resolved IP before the socket connects. This eliminates the rebinding window entirely.

### 1.4 IPv4-Mapped IPv6 Handling

Attackers bypass IPv4 blocklists by embedding IPv4 addresses in IPv6 format:

| Format | Example | Extracted IPv4 |
|--------|---------|---------------|
| Dotted decimal | `::ffff:10.0.0.1` | `10.0.0.1` |
| Hex notation | `::ffff:0a00:0001` | `10.0.0.1` |

**Mitigation:** When you see an IPv6 address starting with `::ffff:`, extract the embedded IPv4 address and validate it against the IPv4 blocklist. Handle both dotted-decimal and hex-encoded formats.

### 1.5 Proxy Awareness

When requests go through a proxy, DNS resolution happens on the proxy side. Your local SSRF guard can't validate the resolved IP because it never sees it.

**Options:**
1. Rely on the proxy's own SSRF protection (document this assumption)
2. Pre-resolve DNS locally before proxying (adds latency, may not match proxy's resolution)
3. Use an allowlist of permitted destination hostnames when proxying

### 1.6 SSRF Implementation Checklist

- [ ] Block all private IPv4 ranges (`10/8`, `172.16/12`, `192.168/16`)
- [ ] Block link-local (`169.254/16`) — cloud metadata lives here
- [ ] Block CGNAT/shared (`100.64/10`) — some cloud metadata lives here too
- [ ] Block IPv6 private equivalents (`fc00::/7`, `fe80::/10`)
- [ ] Extract and validate IPv4 from IPv4-mapped IPv6 (`::ffff:x.x.x.x`)
- [ ] Validate at socket connect time (not request time)
- [ ] Handle both hex and dotted-decimal IPv4-mapped formats
- [ ] Document proxy behavior and assumptions
- [ ] Allow loopback for local dev (or use explicit allowlist)
- [ ] Log blocked requests for security monitoring

---

## Part 2: Unicode and Injection Defense

### 2.1 The Threat Model

AI agents process text from many sources: user input, file contents, web pages, API responses, MCP server outputs, clipboard. Attackers embed invisible instructions in this text using:

- **Unicode Tag characters** (U+E0000-U+E007F): Invisible, pass through most text displays
- **Zero-width characters** (U+200B-U+200F): Invisible joiners and markers
- **Directional overrides** (U+202A-U+202E): Change text rendering direction
- **Private use area** (U+E000-U+F8FF): Undefined characters that may render differently
- **Format characters** (Unicode category Cf): General invisible formatting

These characters are invisible to humans but processed by the agent's language model, potentially altering its behavior.

### 2.2 The Normalization Pipeline

Apply this pipeline to ALL text inputs before they reach the agent's language model:

```
Raw Input
  -> NFKC Normalization (decompose + recompose to canonical form)
  -> Unicode Property Class Removal (strip Cf, Co, Cn categories)
  -> Explicit Range Removal (fallback for limited regex engines)
  -> Recursive Application (handle nested objects/arrays)
  -> Iteration Limit Check (prevent pathological inputs)
```

### 2.3 NFKC Normalization

**Why NFKC, not NFC:** NFKC (Compatibility Decomposition + Canonical Composition) handles more edge cases:

| Input | NFC Result | NFKC Result |
|-------|-----------|-------------|
| `ﬁ` (U+FB01 ligature) | `ﬁ` (unchanged) | `fi` (decomposed) |
| `½` (U+00BD) | `½` (unchanged) | `1/2` (decomposed) |
| `Ａ` (U+FF21 fullwidth) | `Ａ` (unchanged) | `A` (normalized) |

NFKC catches homograph attacks where visually similar characters from different Unicode blocks are used to bypass string matching.

### 2.4 Dangerous Character Categories

Strip characters in these Unicode General Categories:

| Category | Code | What It Contains | Why Strip |
|----------|------|-----------------|-----------|
| Format | `Cf` | Soft hyphens, joiners, directional marks, tag characters | Invisible formatting that can alter interpretation |
| Private Use | `Co` | Undefined characters in U+E000-F8FF, U+F0000-FFFFD | No standard meaning, could be interpreted unpredictably |
| Unassigned | `Cn` | Characters not yet assigned in Unicode | Future-proofing against new invisible characters |

**Implementation:**

```
# Using Unicode property escapes (modern regex engines)
text.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')
```

### 2.5 Explicit Character Range Fallback

For environments where Unicode property escapes aren't available, strip these explicit ranges:

| Range | Name | Risk |
|-------|------|------|
| U+200B-U+200F | Zero-width spaces, directional marks | Invisible text manipulation |
| U+202A-U+202E | Directional formatting (LRE, RLE, PDF, LRO, RLO) | Text direction override |
| U+2066-U+2069 | Directional isolates (LRI, RLI, FSI, PDI) | Text direction isolation |
| U+FEFF | Byte Order Mark | Invisible when not at file start |
| U+E000-U+F8FF | Private Use Area | Undefined behavior |
| U+E0000-U+E007F | Tags block | ASCII smuggling — invisible ASCII copies |

### 2.6 Recursive Sanitization

Text inputs aren't always flat strings. Agent tool inputs are often nested objects or arrays. Apply sanitization recursively:

```
sanitize(input):
  if input is string:
    return normalize_and_strip(input)
  if input is array:
    return [sanitize(item) for item in input]
  if input is object:
    return {sanitize(key): sanitize(value) for key, value in input}
  return input  // numbers, booleans, null pass through
```

**Safety limit:** Cap recursion depth or iteration count (e.g., 10 passes) to prevent pathological inputs that expand during normalization.

### 2.7 Where to Apply Sanitization

| Input Source | Sanitize? | Why |
|-------------|-----------|-----|
| User chat input | Yes | Users may paste text containing hidden characters |
| File contents (read by agent) | Yes | Files from untrusted sources |
| Web page content | Yes | Pages may contain injection attempts |
| API/MCP server responses | Yes | External servers are untrusted |
| Tool outputs | Yes | Tool results may contain attacker-controlled content |
| Agent-generated text | No | Already clean (generated by the model) |
| System prompts | No | Controlled by the application |

### 2.8 HTTP Header Injection Prevention

When agent systems make HTTP requests with user-influenced headers (e.g., hook configurations with environment variable interpolation):

**Strip from header values:**
- `\r` (CR, U+000D) — HTTP header injection via CRLF
- `\n` (LF, U+000A) — Header splitting
- `\0` (NUL, U+0000) — String truncation

**Strip from URLs:**
- Same characters as headers
- Additionally validate URL structure after variable interpolation

---

## 3. Defense Integration

These two defense layers (SSRF + Unicode) work together:

```
Agent receives tool input with URL
  -> Unicode sanitization (strip hidden chars from URL and parameters)
  -> URL validation (structure, scheme, known-safe hosts)
  -> DNS resolution with SSRF guard (block private IPs at connect time)
  -> Request execution
  -> Response sanitization (strip hidden chars from response body)
  -> Return to agent
```

**Key Insight:** Sanitize both directions. Attacker-controlled content can enter via input (prompt injection) or output (response injection). Clean everything.

---

## 4. Testing Your Defenses

### SSRF Test Cases

```
# Direct private IP access
http://10.0.0.1/admin
http://169.254.169.254/latest/meta-data/

# IPv4-mapped IPv6
http://[::ffff:169.254.169.254]/
http://[::ffff:0a00:0001]/

# DNS rebinding (requires attacker DNS server)
http://rebind.attacker.com/  (resolves to 169.254.169.254 on second lookup)

# Decimal IP encoding
http://2852039166/  (169.254.169.254 as decimal)

# Octal IP encoding
http://0251.0376.0251.0376/

# CGNAT range
http://100.100.100.200/  (Alibaba metadata)
```

### Unicode Injection Test Cases

```
# Zero-width space in command
cat[U+200B]/etc/passwd

# Tag characters (ASCII smuggling)
Hello[U+E0048][U+E0065][U+E006C][U+E0070]  (invisible "Help")

# Directional override
user[U+202E]nimda  (renders as "admin" when reversed)

# Homograph attack
pаypal.com  (Cyrillic 'а' at position 2)

# BOM injection
[U+FEFF]rm -rf /  (invisible prefix)

# Private use area
normal text[U+E000]hidden instruction[U+E001]more normal text
```

---

## Related Documents

- [AGENT-SECURITY-COMMAND-EXECUTION.md](AGENT-SECURITY-COMMAND-EXECUTION.md) — Command execution security (includes Unicode path normalization)
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission system that gates network access
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool validation pipeline where sanitization is applied
