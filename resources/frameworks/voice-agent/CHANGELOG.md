# HVAC Grace Rollback Changelog

## Current Snapshot: 2026-02-02 16:08 EST (Silver Build)

**Status:** Production-ready with all Phase 1-4 fixes plus Silver refinements

### Silver Build Fixes Applied
- Dead air eliminated (bridge phrases on all routing functions)
- Phone numbers use spaces not dashes (TTS won't say " minus\)
- Looping behavior fixed (deduplicated instructions)
- Customer reality fixes (time-aware OT, emergency detection, part descriptions)
- Billing questions structured (two-part questions)
- On-call tech / callback time promises REMOVED
- Closing loop fixed (say closing once, stop)

### What's Included
- hvac_agent.py - Main agent with all fixes
- prompts/ - All specialist prompts (service, billing, parts, etc.)
- tts_filter.py - TTS safety regex for phone numbers
- Supporting modules

### Rollback Instructions
\\\ash
sudo systemctl stop hvac-grace-agent
cp -r ./rollback/* ./
sudo systemctl start hvac-grace-agent
\\\

---
## Previous Snapshots

### Bronze MVP (2026-02-02 15:41 EST)
- First working multi-agent build
- Phase 1-4 seamless handoffs
- Known issues: dead air, phone minus, looping
