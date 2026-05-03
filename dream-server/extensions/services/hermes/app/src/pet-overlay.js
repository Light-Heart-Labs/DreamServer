const PET_FRAME = { width: 192, height: 208 };
const PET_ROWS = {
  idle: { row: 0, frames: 6, fps: 2 },
  "running-right": { row: 1, frames: 8, fps: 8 },
  "running-left": { row: 2, frames: 8, fps: 8 },
  waving: { row: 3, frames: 4, fps: 5 },
  jumping: { row: 4, frames: 5, fps: 7 },
  failed: { row: 5, frames: 8, fps: 5 },
  waiting: { row: 6, frames: 6, fps: 3 },
  running: { row: 7, frames: 6, fps: 7 },
  review: { row: 8, frames: 6, fps: 4 }
};

const STATUS_LABELS = {
  idle: "online",
  waiting: "pronta",
  running: "rodando",
  review: "revisao",
  failed: "alerta",
  waving: "oi",
  jumping: "energia"
};

const state = {
  mode: "idle",
  frame: 0,
  timer: null,
  bubbleEnabled: true,
  voiceEnabled: false,
  voiceName: "",
  lastSpeechAt: 0,
  pointer: null,
  holdTimer: null,
  clickTimer: null,
  clickCount: 0
};

const elements = {
  surface: document.querySelector(".pet-drag-surface"),
  sprite: document.getElementById("petSprite"),
  bubble: document.getElementById("petBubble"),
  status: document.getElementById("petStatus")
};

function renderFrame() {
  const row = PET_ROWS[state.mode] || PET_ROWS.idle;
  const frame = state.frame % row.frames;
  elements.sprite.style.backgroundPosition = `-${frame * PET_FRAME.width}px -${row.row * PET_FRAME.height}px`;
}

function setMode(mode) {
  const nextMode = PET_ROWS[mode] ? mode : "idle";
  if (state.mode === nextMode && state.timer) {
    return;
  }
  state.mode = nextMode;
  state.frame = 0;
  document.body.dataset.petState = nextMode;
  elements.status.textContent = STATUS_LABELS[nextMode] || nextMode;
  renderFrame();
  if (state.timer) {
    clearInterval(state.timer);
  }
  const row = PET_ROWS[nextMode] || PET_ROWS.idle;
  state.timer = setInterval(() => {
    state.frame = (state.frame + 1) % row.frames;
    renderFrame();
  }, Math.max(90, Math.round(1000 / row.fps)));
}

function setBubble(text) {
  const line = String(text || "Dreamserver online.").trim();
  if (!state.bubbleEnabled || !line) {
    elements.bubble.hidden = true;
    return;
  }
  elements.bubble.hidden = false;
  elements.bubble.textContent = line;
  elements.bubble.style.animation = "none";
  void elements.bubble.offsetHeight;
  elements.bubble.style.animation = "";
}

function petVoices() {
  try {
    return Array.from(window.speechSynthesis?.getVoices?.() || []);
  } catch {
    return [];
  }
}

function selectedVoice() {
  const voices = petVoices();
  const configured = String(state.voiceName || "").trim();
  if (configured) {
    return voices.find((voice) => voice.name === configured) || null;
  }
  const feminineVoice = /maria|francisca|luciana|helia|zira|jenny|aria|female|feminina/i;
  return voices.find((voice) => /pt[-_]?br/i.test(voice.lang || "") && feminineVoice.test(voice.name || "")) ||
    voices.find((voice) => feminineVoice.test(voice.name || "")) ||
    null;
}

function speak(text, force = false) {
  const line = String(text || "").trim();
  if (!line) {
    setBubble("");
    return;
  }
  setBubble(line);
  const now = Date.now();
  if (!state.voiceEnabled || !("speechSynthesis" in window) || (!force && now - state.lastSpeechAt < 6500)) {
    return;
  }
  try {
    const voice = selectedVoice();
    if (!voice) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.voice = voice;
    utterance.lang = voice.lang || "pt-BR";
    utterance.rate = 1.03;
    utterance.pitch = 1.22;
    utterance.volume = 0.72;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    state.lastSpeechAt = now;
  } catch {
    // Bubble remains visible even when OS speech is unavailable.
  }
}

window.dreamPet?.onUpdate((payload) => {
  state.bubbleEnabled = payload.bubbleEnabled !== false;
  state.voiceEnabled = payload.voiceEnabled === true;
  state.voiceName = String(payload.voiceName || "");
  document.body.dataset.bubbleEnabled = state.bubbleEnabled ? "true" : "false";
  if (!state.bubbleEnabled) {
    elements.bubble.hidden = true;
  }
  setMode(payload.mode || "idle");
  if (payload.line || payload.forceLine) {
    speak(payload.line, Boolean(payload.forceSpeech));
  }
});

function clearHoldTimer() {
  if (state.holdTimer) {
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }
}

function sendInteraction(type) {
  const result = window.dreamPet?.interact?.({ type });
  result?.catch?.(() => {});
}

function registerClick() {
  state.clickCount += 1;
  clearTimeout(state.clickTimer);
  state.clickTimer = setTimeout(() => {
    const count = state.clickCount;
    state.clickCount = 0;
    if (count >= 3) {
      setMode("failed");
      sendInteraction("triple");
      return;
    }
    if (count === 2) {
      setMode("jumping");
      sendInteraction("double");
      return;
    }
    setMode("waving");
    sendInteraction("single");
  }, 310);
}

elements.surface?.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  state.pointer = {
    id: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    moved: false,
    held: false
  };
  elements.surface.classList.add("is-grabbing");
  elements.surface.setPointerCapture?.(event.pointerId);
  clearHoldTimer();
  state.holdTimer = setTimeout(() => {
    if (!state.pointer || state.pointer.id !== event.pointerId || state.pointer.moved) {
      return;
    }
    state.pointer.held = true;
    setMode("jumping");
    sendInteraction("hold");
  }, 560);
  event.preventDefault();
});

elements.surface?.addEventListener("pointermove", (event) => {
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) {
    return;
  }
  const dx = event.clientX - pointer.startClientX;
  const dy = event.clientY - pointer.startClientY;
  if (Math.abs(dx) + Math.abs(dy) > 5) {
    pointer.moved = true;
    clearHoldTimer();
    setMode(dx < 0 ? "running-left" : "running-right");
  }
  if (!pointer.moved) {
    return;
  }
  window.dreamPet?.moveTo({
    x: event.screenX - pointer.startClientX,
    y: event.screenY - pointer.startClientY
  });
});

function finishPointer(event) {
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) {
    return;
  }
  clearHoldTimer();
  elements.surface?.classList.remove("is-grabbing");
  elements.surface?.releasePointerCapture?.(event.pointerId);
  state.pointer = null;
  if (pointer.moved) {
    setMode("waiting");
    const result = window.dreamPet?.persistPosition?.();
    result?.catch?.(() => {});
    sendInteraction("drag");
    return;
  }
  if (pointer.held) {
    setTimeout(() => setMode("idle"), 1000);
    return;
  }
  registerClick();
}

elements.surface?.addEventListener("pointerup", finishPointer);
elements.surface?.addEventListener("pointercancel", finishPointer);
window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});

setMode("idle");
window.dreamPet?.ready();
