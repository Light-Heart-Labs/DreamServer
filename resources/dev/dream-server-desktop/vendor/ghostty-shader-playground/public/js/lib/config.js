import { generateID } from "./utils.js";

class Configuration {
  players = [
    {
      shader: "debug_cursor_static.glsl",
      showTexture: false,
      id: generateID(),
    },
    {
      shader: "cursor_smear.glsl",
      showTexture: false,
      id: generateID(),
    },
  ];
  backgroundColor = "#0b0e14";
  cursorColor = "#fedf16";
  tickRate = 500;
  mode = "auto";
  cursorType = "block";
  version = undefined;

  constructor() {
    let memory = JSON.parse(localStorage.getItem("config"));
    memory = this.upgradeVersion(memory);

    if (memory) {
      Object.assign(this, memory);
    }
  }

  save() {
    const config = {};
    for (const [key, value] of Object.entries(this)) {
      if (typeof value !== "function") {
        config[key] = value;
      }
    }
    localStorage.setItem("config", JSON.stringify(config));
  }

  upgradeVersion(config) {
    const CURRENT = 2;

    const cfg = { ...config };

    if (cfg.version === CURRENT) return cfg;

    let updatedConfig;

    switch (cfg.version || 1) {
      case 1:
        updatedConfig = {
          tickRate: cfg.tickRate ?? this.tickRate,
          version: 2,
          backgroundColor: cfg.backgroundColor ?? this.backgroundColor,
          cursorColor: cfg.cursorColor ?? this.cursorColor,
          mode: cfg.mode ?? this.mode,
          cursorType: cfg.cursorType ?? this.cursorType,
          players: (
            cfg.canvas ?? ["cursor_smear.glsl", "debug_cursor_static.glsl"]
          ).map((c) => ({
            shader: c,
            showTexture: false,
            id: generateID(),
          })),
        };
        break;

      // case 2:
      //   updatedConfig = {
      //     ...cfg,
      //     version: 3,
      //   };
      //   break;

      default:
        console.warn(`Unknown config version: ${cfg.version}, leaving as is`);
        return cfg;
    }

    // Recurse to next version
    return this.upgradeVersion(updatedConfig);
  }
}

export { Configuration };
