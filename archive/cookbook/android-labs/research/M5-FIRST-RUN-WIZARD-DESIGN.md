# M5 First-Run Wizard Design

*Solving Gap #1: "After install, user sees dashboard but doesn't know what to do next"*

## Problem

Current flow:
1. User runs installer ✅
2. Services start ✅
3. User opens dashboard
4. User sees... a bunch of panels
5. User thinks: "Now what?"
6. User closes tab, never returns ❌

## Solution: Guided First-Run Experience

### Detection

```python
# In dashboard-api startup
def check_first_run():
    config_path = "/data/config/setup-complete.json"
    return not os.path.exists(config_path)
```

When `first_run == True`, dashboard redirects to `/setup` wizard.

### Wizard Steps

#### Step 1: Welcome (5 seconds)

```
┌─────────────────────────────────────────────┐
│                                             │
│     🌙 Welcome to Dream Server              │
│                                             │
│     Your personal AI is ready.              │
│     Let's set it up together.               │
│                                             │
│              [ Get Started ]                │
│                                             │
└─────────────────────────────────────────────┘
```

**Goal:** Emotional hook. User feels welcomed, not overwhelmed.

#### Step 2: Choose Your Assistant (30 seconds)

```
┌─────────────────────────────────────────────┐
│  What kind of assistant do you want?        │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │  💬     │ │  💻     │ │  🎨     │       │
│  │ General │ │ Coding  │ │Creative │       │
│  │ Helper  │ │ Buddy   │ │ Writer  │       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                             │
│  ○ General Helper (recommended)             │
│    Good at everything, friendly tone        │
│                                             │
│  ○ Coding Buddy                             │
│    Technical, precise, loves code           │
│                                             │
│  ○ Creative Writer                          │
│    Imaginative, expressive, storyteller     │
│                                             │
│             [ Continue ]                    │
└─────────────────────────────────────────────┘
```

**Implementation:** Sets system prompt in `/data/config/persona.json`

#### Step 3: Test Your Voice (60 seconds)

```
┌─────────────────────────────────────────────┐
│  Let's test voice chat                      │
│                                             │
│         🎤                                  │
│    [ Click to speak ]                       │
│                                             │
│  Say: "Hello, can you hear me?"             │
│                                             │
│  ─────────────────────────────              │
│  Status: Waiting for microphone...          │
│                                             │
│         [ Skip voice setup ]                │
└─────────────────────────────────────────────┘
```

**On success:**
```
┌─────────────────────────────────────────────┐
│                                             │
│     ✅ Voice is working!                    │
│                                             │
│     I heard: "Hello, can you hear me?"      │
│                                             │
│     🔊 [Playing response...]                │
│     "Hi! Yes, I can hear you perfectly.     │
│      I'm excited to help you today!"        │
│                                             │
│             [ Continue ]                    │
└─────────────────────────────────────────────┘
```

**On failure:** Show troubleshooting, offer to skip.

#### Step 4: Quick Win (30 seconds)

```
┌─────────────────────────────────────────────┐
│  Let's try something useful                 │
│                                             │
│  Ask me anything:                           │
│  ┌─────────────────────────────────────┐   │
│  │ What's a good recipe for pasta?     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Or try these:                              │
│  • "Explain quantum computing simply"       │
│  • "Write a haiku about coffee"             │
│  • "Help me plan my weekend"                │
│                                             │
│             [ Ask ]                         │
└─────────────────────────────────────────────┘
```

**Goal:** User gets immediate value. Dopamine hit. They'll come back.

#### Step 5: You're Ready! (10 seconds)

```
┌─────────────────────────────────────────────┐
│                                             │
│     🎉 You're all set!                      │
│                                             │
│     Your AI assistant is ready to help.     │
│                                             │
│     Tips:                                   │
│     • Press 🎤 to talk anytime              │
│     • Check Workflows for automation        │
│     • Visit Settings to customize           │
│                                             │
│        [ Go to Dashboard ]                  │
│                                             │
└─────────────────────────────────────────────┘
```

### Technical Implementation

#### Files to Create/Modify

```
dream-server/
├── dashboard/
│   ├── src/
│   │   ├── routes/
│   │   │   └── setup/
│   │   │       ├── +page.svelte      # Wizard container
│   │   │       ├── Welcome.svelte    # Step 1
│   │   │       ├── Persona.svelte    # Step 2
│   │   │       ├── VoiceTest.svelte  # Step 3
│   │   │       ├── QuickWin.svelte   # Step 4
│   │   │       └── Complete.svelte   # Step 5
│   │   └── lib/
│   │       └── stores/
│   │           └── setup.ts          # Wizard state
├── dashboard-api/
│   └── routes/
│       └── setup.py                  # Setup status API
└── data/
    └── config/
        ├── setup-complete.json       # First-run flag
        └── persona.json              # User's persona choice
```

#### API Endpoints

```python
# GET /api/setup/status
{"first_run": true, "step": 0}

# POST /api/setup/persona
{"persona": "general"}  # or "coding", "creative"

# POST /api/setup/complete
# Marks setup as done, redirects to dashboard
```

### Estimated Effort

| Component | Hours |
|-----------|-------|
| Wizard UI (Svelte) | 4h |
| API endpoints | 2h |
| Voice test integration | 2h |
| Persona system prompts | 1h |
| Testing & polish | 3h |
| **Total** | **12h** |

### Success Metrics

- **Completion rate:** >80% of users finish wizard
- **Voice test success:** >70% pass on first try
- **Return rate:** Users come back within 24h

---

*Design by Todd, 2026-02-10. Addresses M5 Gap #1.*
