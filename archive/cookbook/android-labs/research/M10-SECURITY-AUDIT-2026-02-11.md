# M10 Security Audit — 2026-02-11

**Mission:** M10 (Security & Secrets Hygiene)  
**Status:** Audit complete, remediation plan drafted  
**Tool:** detect-secrets v1.5.0

## Summary

| Category | Findings | Status |
|----------|----------|--------|
| Placeholder secrets | 10+ files with "not-needed" | ⚠️ Needs fix |
| .env files | 3 potential secrets | ⚠️ Review needed |
| High entropy strings | 1 pytest cache | ✅ False positive |

## Detailed Findings

### 1. Placeholder Credentials (CRITICAL)

**Pattern:** `api_key="not-needed"` or similar placeholders

**Files Affected:**
| File | Line | Content |
|------|------|---------|
| `agents/voice/agent.py` | 69 | `api_key="not-needed"` |
| `agents/voice/agent_m4.py` | 237 | `api_key="not-needed"` |
| `config/litellm/config.yaml` | 10 | `api_key: not-needed` |
| `config/openclaw/*.json` | 13 | `"apiKey": "not-needed"` |
| `QUICKSTART.md` | 71 | `"apiKey": "not-needed"` |

**Risk:** Placeholders that "work" in production create security vulnerabilities.

**Fix:** Generate random secrets in installer, never use hardcoded defaults.

### 2. .env File Secrets

**File:** `dream-server/.env`

**Lines:** 42, 70, 71
- Requires manual review
- May be legitimate environment variables

### 3. False Positives

**File:** `.pytest_cache/CACHEDIR.TAG`
- High entropy string in cache file
- Not a real secret

## Remediation Plan

### Phase 1: Immediate (This Session)
- [ ] Replace "not-needed" with `${API_KEY}` template syntax
- [ ] Update installer to generate random secrets
- [ ] Add `.env` to `.gitignore` if not already present

### Phase 2: Short-term
- [ ] Install pre-commit hooks (detect-secrets)
- [ ] Scan entire repo (not just dream-server/)
- [ ] Document secret generation in install script

### Phase 3: Long-term
- [ ] Consider HashiCorp Vault for production
- [ ] Implement secret rotation
- [ ] Add security section to documentation

## Commands Used

```bash
# Install detect-secrets
pip install detect-secrets

# Scan specific directory
detect-secrets scan dream-server/ --all-files

# Scan entire repo (slow)
detect-secrets scan --all-files > security-audit.json
```

## References

- MISSIONS.md M10: Security & Secrets Hygiene
- M10 "Done when": `detect-secrets scan` returns zero findings
