export function hexToRgbNormalized(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1];
}

// This was made completely with ChatGPT
export function generateID() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      return [...bytes]
        .map((b, i) =>
          [4, 6, 8, 10].includes(i)
            ? "-" + b.toString(16).padStart(2, "0")
            : b.toString(16).padStart(2, "0"),
        )
        .join("");
    }
  } catch (_) {}

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class $ {
  /**
   * Safely create an element from a CSS-like selector (e.g. "div#app.main.container")
   * @param {string} selector
   * @returns {HTMLElement}
   */
  static createElement(selector) {
    // letters, numbers, dash, underscore only
    const safePattern =
      /^[a-zA-Z][a-zA-Z0-9-]*(#[a-zA-Z0-9_-]+)?(\.[a-zA-Z0-9_-]+)*$/;

    if (selector === undefined || !safePattern.test(selector)) {
      throw new Error(`Invalid selector: "${selector}"`);
    }

    const [tagAndId, ...classes] = selector.split(".");
    const [tag, id] = tagAndId.split("#");

    const el = document.createElement(tag || "div");

    if (id) el.id = id;
    if (classes.length) el.classList.add(...classes);

    return el;
  }
}
