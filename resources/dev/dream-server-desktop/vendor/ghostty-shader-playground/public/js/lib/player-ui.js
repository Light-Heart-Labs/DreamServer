import { global } from "./global.js";
import { $ } from "./utils.js";
class PlayerUI {
  element;
  onRemove;
  onShaderChange;
  onPip;
  onTexture;
  onSpeedChange;
  messages;
  constructor(playerID, onRemove, onShaderChange, onPip, onTexture, onSpeedChange) {
    this.onRemove = onRemove;
    this.onShaderChange = onShaderChange;
    this.onPip = onPip;
    this.onTexture = onTexture;
    this.onSpeedChange = onSpeedChange;
    const playerSettings = global.config.players.find((p) => p.id == playerID);

    this.element = this._createUILayer();

    let toolbox = this._createToolbox();

    let selectMenu = this._createShaderListSelect(playerSettings?.shader);
    let speedMenu = this._createSpeedControl();
    let removeButtonEl = this._createRemoveButton(onRemove);
    let pipButtonEl = this._createPiPButton();
    let cb = this._createShowBackgroundCheckbox(playerSettings?.showTexture);

    toolbox.append(selectMenu, speedMenu, removeButtonEl, pipButtonEl, cb);

    selectMenu.dispatchEvent(new Event("change"));
    speedMenu.dispatchEvent(new Event("change"));
    cb.firstElementChild.dispatchEvent(new Event("change"));

    let messagesArea = this._createMessagesArea();
    this.element.append(toolbox, messagesArea);

    this.onError = (error) => {
      console.error(`[${error.type}]`, error.message);
      let errorPopup = this._createPopup(error);
      messagesArea.replaceChildren(errorPopup);
    };
    this.onSuccess = (message) => {
      messagesArea.innerHTML = "";
    };
  }

  onError = (error) => {
    console.error(error);
  };
  onSuccess = (message) => {
    console.warn(message);
  };

  _createPopup(error) {
    const popupEl = $.createElement("div._error-popup");
    const titleEl = $.createElement("div._title");
    const messageEl = $.createElement("div._message");
    const codeContainer = $.createElement("div._codeBox");

    // Calculate line offset relative to the //$REPLACE$ marker
    const replaceMarkerIndex = global.wrapper.lastIndexOf("//$REPLACE$");
    const lineOffset =
      global.wrapper.slice(0, replaceMarkerIndex).split("\n").length - 1;

    titleEl.innerText = error.type ?? "Error";
    messageEl.innerText = error.message ?? "Unknown error";

    if (error.context?.lines?.length) {
      const lineElements = error.context.lines.map((lineInfo) => {
        const isErrorLine = lineInfo.lineNumber === error.context.errorLine;
        const lineEl = $.createElement(
          `div._line${isErrorLine ? "._culprit" : ""}`,
        );

        const numberEl = $.createElement("div._number.noselect");
        numberEl.innerText = `${lineInfo.lineNumber - lineOffset}`;

        const codeEl = $.createElement("pre");
        codeEl.innerText = lineInfo.code;

        lineEl.append(numberEl, codeEl);
        return lineEl;
      });

      codeContainer.append(...lineElements);
    }

    popupEl.append(titleEl, messageEl, codeContainer);
    return popupEl;
  }

  _createUILayer() {
    const div = $.createElement("div._ui-layer");
    return div;
  }
  _createToolbox() {
    return $.createElement("div._toolbox.gap-1.p-1");
  }
  _createMessagesArea() {
    const div = $.createElement("div._messages-area");
    return div;
  }

  _createShowBackgroundCheckbox(state) {
    const label = $.createElement("label.noselect");
    label.innerText = "Load texture";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state;

    cb.addEventListener("change", (event) => {
      this.onTexture(event.target.checked);
    });
    label.appendChild(cb);

    return label;
  }

  _createShaderListSelect(fileName) {
    const selectMenu = document.createElement("select");
    global.shaderList.forEach((shader) => {
      const option = document.createElement("option");
      option.value = shader;
      option.textContent = shader;
      selectMenu.appendChild(option);
    });

    selectMenu.addEventListener("change", (event) => {
      this.onShaderChange(event.target.value);
    });
    selectMenu.value = fileName ?? "debug_cursor_static.glsl";
    return selectMenu;
  }

  _createSpeedControl() {
    const selectMenu = document.createElement("select");
    const speeds = [
      { label: "1x", value: 1.0 },
      { label: "0.5x", value: 0.5 },
      { label: "0.25x", value: 0.25 },
    ];
    
    speeds.forEach((speed) => {
      const option = document.createElement("option");
      option.value = speed.value;
      option.textContent = speed.label;
      selectMenu.appendChild(option);
    });

    selectMenu.addEventListener("change", (event) => {
      if (this.onSpeedChange) {
        this.onSpeedChange(parseFloat(event.target.value));
      }
    });
    
    return selectMenu;
  }

  _createPiPButton() {
    if (!global.video.requestPictureInPicture) {
      return "";
    }
    const button = document.createElement("button");
    button.setAttribute("data-tooltip", "Picture in Picture");
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#333"><path d="M80-520v-80h144L52-772l56-56 172 172v-144h80v280H80Zm80 360q-33 0-56.5-23.5T80-240v-200h80v200h320v80H160Zm640-280v-280H440v-80h360q33 0 56.5 23.5T880-720v280h-80ZM560-160v-200h320v200H560Z"/></svg>`;
    button.addEventListener("click", this.onPip);

    return button;
  }

  _createRemoveButton(onRemove) {
    const button = document.createElement("button");
    button.setAttribute("data-tooltip", "Remove player");
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#ff0000"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>`;
    button.addEventListener("click", onRemove);
    return button;
  }
}
export { PlayerUI };
