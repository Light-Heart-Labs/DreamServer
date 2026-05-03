import { ShaderPlayer } from "./lib/player.js";
import { global } from "./lib/global.js";
import { getShaderList, getGhosttyWrapper } from "./lib/service.js";
import { generateID } from "./lib/utils.js";

let intervalId = undefined;
let players = [];

function setTickRate(interval) {
  if (intervalId) {
    clearInterval(intervalId);
  }
  intervalId = setInterval(() => {
    tick();
  }, interval);
}

global.bus.subscribe((event) => {
  switch (event.type) {
    case "cursorColor":
      global.config.cursorColor = event.data;
      global.config.save();
      break;
    case "backgroundColor":
      global.config.backgroundColor = event.data;
      global.config.save();
      break;
  }
});

function tick() {
  players.forEach((p) => p.tick());
}
setTickRate(global.config.tickRate);

window.changeCursorType = (width, height) => {
  global.bus.emit({ type: "changeCursor", data: { width, height } });
};
window.addPlayer = () => {
  let playerSettings = newPlayerSettings();
  global.config.players.push(playerSettings);
  addPlayer(playerSettings);
};

window.reloadShader = (shader) => {
  console.log(`Shader changed: ${shader}`);
  players.filter((p) => p.file === shader).forEach((p) => p.load());
};

window.changeMode = (mode) => {
  global.bus.emit({ type: "changeMode", data: mode });
};
window.addEventListener("resize", function () {
  setGrid();
});
window.addEventListener("keydown", function (event) {
  if (event.key) {
    let move = "right";
    switch (event.key) {
      case "Enter":
      case "ArrowDown":
        move = "down";
        break;
      case "ArrowLeft":
      case "Backspace":
        move = "left";
        break;
      case "ArrowUp":
        move = "up";
        break;
      default:
        move = "right";
        break;
    }
    global.bus.emit({ type: "keyboard", data: move });
  }
});

let tickRateInput = document.getElementById("tickRate");
tickRateInput.value = global.config.tickRate;
tickRateInput.addEventListener("input", (event) => {
  setTickRate(event.target.value);
  global.config.tickRate = event.target.value ?? 50;
  global.config.save();
});

let cursorColorInput = document.getElementById("cursorColor");
cursorColorInput.value = global.config.cursorColor;
cursorColorInput.addEventListener("input", (event) => {
  global.bus.emit({ type: "cursorColor", data: event.target.value });
});

let backgroundColorInput = document.getElementById("backgroundColor");
backgroundColorInput.value = global.config.backgroundColor;
backgroundColorInput.addEventListener("input", (event) => {
  global.bus.emit({ type: "backgroundColor", data: event.target.value });
});

const playground = document.getElementById("playground");
Promise.all([getGhosttyWrapper(), getShaderList()]).then(
  ([ghosttyWrapper, list]) => {
    global.wrapper = ghosttyWrapper;
    global.shaderList = list;
    global.config.players.forEach((player) => {
      addPlayer(player);
    });
  },
);

function addPlayer(playerConfig) {
  var player = new ShaderPlayer(playerConfig.id, removePlayer);
  playground.append(player.wrapper);
  players.push(player);
  setGrid();
}

function newPlayerSettings() {
  return {
    id: generateID(),
    shader: "debug_cursor_static.glsl",
    showTexture: false,
  };
}

function removePlayer(player) {
  player.wrapper.remove();
  let index = players.findIndex((p) => p.id === player.id);
  global.config.players.splice(index, 1);
  global.config.save();
  players = players.filter((p) => p !== player);
  setGrid();
}

function setGrid() {
  let gridValue = players.reduce((a, b) => a + " 1fr", "");
  const isVertical = window.innerHeight > window.innerWidth;
  if (isVertical) {
    playground.style.gridTemplateColumns = "unset";
    playground.style.gridTemplateRows = gridValue;
  } else {
    playground.style.gridTemplateColumns = gridValue;
    playground.style.gridTemplateRows = "unset";
  }
}
