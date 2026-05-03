import { CanvasGLSL } from "./canvas-glsl.js";
import { global } from "./global.js";
import { getShader } from "./service.js";
import { hexToRgbNormalized, $ } from "./utils.js";
import { PlayerUI } from "./player-ui.js";
import { Cursor } from "./cursor.js";

/**
 * @class ShaderPlayer
 * @property {string} vertex
 * @property {CanvasGLSL} renderer
 * @property {HTMLDivElement} wrapper
 * @property {HTMLCanvasElement} canvas
 * @property {Bus} bus
 */
class ShaderPlayer {
  ui;
  vertex = `#version 300 es
    in vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }`;
  renderer;
  wrapper;
  canvas;
  textureCanvas;
  clickListener;
  presetPosition = 0;
  id = -1;
  file = "debug_cursor_static.glsl";
  tickFunction = () => {
    this.changePresetPosition(1);
  };
  img1 = undefined;
  cursor;
  /**
   * @param {HTMLElement} _
   * @param {Bus} bus
   */
  constructor(id, removeFn) {
    this.cursor = new Cursor();
    this.id = id;
    this.wrapper = $.createElement("div._canvas-wrapper");

    this.canvas = $.createElement("canvas._shader");
    this.textureCanvas = $.createElement("canvas._texture");

    this.ui = new PlayerUI(
      this.id,
      () => {
        removeFn(this);
      },
      this.onChangeShader,
      this.onPip,
      this.onTexture,
      this.onSpeedChange,
    );
    this.wrapper.append(this.canvas, this.textureCanvas, this.ui.element);
    const resizeObserver = new ResizeObserver(() => {
      const rect = this.wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.textureCanvas.width = rect.width * dpr;
      this.textureCanvas.height = rect.height * dpr;
      this._drawBackround(global.config.backgroundColor);
    });
    resizeObserver.observe(this.wrapper);

    this.renderer = new CanvasGLSL(this.canvas);
    this.renderer.onError = this.ui.onError;
    this.renderer.onSuccess = this.ui.onSuccess;

    this.clickListener = this.canvas.addEventListener("click", (event) => {
      const rect = this.canvas.getBoundingClientRect();

      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (rect.height - (event.clientY - rect.top)) * scaleY;

      global.bus.emit({ type: "click", data: { x, y } });
    });
    var subscription = global.bus.subscribe((event) => {
      switch (event.type) {
        case "cursorColor":
          this.onCursorColor(event.data);
          break;
        case "backgroundColor":
          this.onBackgrounColor(event.data);
          break;
        case "keyboard":
          this.onKeyboard(event.data);
          break;
        case "changeCursor":
          this.onChangeCursor(event.data);
          break;
        case "click":
          this.onClick(event.data);
          break;
        case "changeMode":
          this.onChangeMode(event.data);
          break;
      }
    });
  }

  onCursorColor = (color) => {
    this.cursor.setColor(color);
    this.renderer.setUniform("iCurrentCursorColor", ...this.cursor.color);
  };

  onBackgrounColor = (color) => {
    this._drawBackround(color);
  };

  onKeyboard = (direction) => {
    this.cursor.move(direction);
    this.updateCursorUniform(this.cursor);
  };

  onChangeCursor = (size) => {
    this.cursor.setSize(size.width, size.height);
    this.updateCursorUniform(this.cursor);
  };

  onClick = (position) => {
    if (this.tickFunction) {
      this.tickFunction();
    } else {
      this.cursor.setPosition(position.x, position.y);
      this.updateCursorUniform(this.cursor);
    }
  };

  onChangeMode = (mode) => {
    switch (mode) {
      case "auto":
        this.tickFunction = () => {
          this.changePresetPosition(1);
        };
        break;
      case "click":
        this.tickFunction = null;
        break;
      case "rnd":
        this.tickFunction = this.randomCursor;
    }
  };

  _drawBackround(color) {
    const ctx = this.textureCanvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.textureCanvas.width, this.textureCanvas.height);
    if (this.img1 && this.img1.complete && this.img1.naturalWidth !== 0) {
      const imgW = this.img1.naturalWidth;
      const imgH = this.img1.naturalHeight;
      
      const wrapperW = this.wrapper.clientWidth;
      const wrapperH = this.wrapper.clientHeight;

      const scale = Math.max(wrapperW / imgW, wrapperH / imgH);
      
      const w = imgW * scale;
      const h = imgH * scale;
      
      const x = 0;
      const y = 0;

      ctx.drawImage(this.img1, 0, 0, w, h);
    }
    if (this.renderer) {
      let texture = this.renderer.createTexture(this.textureCanvas);
      this.renderer.setUniform("iChannel0", texture);
    }
  }

  onTexture = (show) => {
    const playerSettings = global.config.players.find((p) => p.id == this.id);
    playerSettings.showTexture = show;
    global.config.save();

    if (show) {
      this.img1 = new Image();
      this.img1.src = "/img/bg_code.svg";
      this.img1.onload = () => {
        this._drawBackround(global.config.backgroundColor);
      };
    } else {
      this.img1 = undefined;
      this._drawBackround(global.config.backgroundColor);
    }
  };
  onPip = async () => {
    try {
      const stream = this.canvas.captureStream(30); // 30 fps
      global.video.srcObject = stream;
      // ensure video is playing before PiP
      await global.video.play();
      // enter picture-in-picture
      await global.video.requestPictureInPicture();
    } catch (err) {
      console.error("Failed to enter PiP:", err);
    }
  };

  onSpeedChange = (speed) => {
    if (this.renderer) {
      this.renderer.setTimeScale(speed);
    }
  };

  onChangeShader = (name) => {
    this.file = name;
    this.load();
  };

  load() {
    let wrapShader = (shader) => global.wrapper.replace("//$REPLACE$", shader);
    getShader(this.file).then((shaderCode) => {
      let playerSetting = global.config.players.find((p) => p.id == this.id);
      playerSetting.shader = this.file;
      global.config.save();
      var fragment = wrapShader(shaderCode);
      this.play(fragment);
    });
  }

  /**
   * @param {string} fragmentShadder
   */
  play(fragmentShadder) {
    this.renderer.stop();
    this.renderer.loadShader(this.vertex, fragmentShadder);
    this.renderer.start();
    this.renderer.setUniform("iCurrentCursorColor", ...this.cursor.color);
  }

  tick() {
    if (this.tickFunction) {
      this.tickFunction();
    }
  }

  randomCursor() {
    if (!this.canvas) {
      return;
    }
    const x = Math.random() * this.canvas.width;
    const y = Math.random() * this.canvas.height;
    this.cursor.setPosition(x, y);
    this.updateCursorUniform(this.cursor);
  }

  changePresetPosition(increment) {
    let bottom = this.canvas.height * 0.1;
    let top = this.canvas.height * 0.9;
    let left = this.canvas.width * 0.1;
    let right = this.canvas.width * 0.9;

    this.presetPosition = (this.presetPosition + increment) % 7;
    switch (this.presetPosition) {
      case 0:
        this.cursor.setPosition(left, top);
        break;
      case 1:
        this.cursor.setPosition(right, bottom);
        break;
      case 2:
        this.cursor.setPosition(right, top);
        break;
      case 3:
        this.cursor.setPosition(left, top);
        break;
      case 4:
        this.cursor.setPosition(left, bottom);
        break;
      case 5:
        this.cursor.setPosition(right, bottom);
        break;
      case 6:
        this.cursor.setPosition(right, top);
        this.cursor.setPosition(left, bottom);
        break;
    }
    this.updateCursorUniform(this.cursor);
  }

  /**
   * @param {Cursor} cursor
   */
  updateCursorUniform(cursor) {
    if (!this.renderer.isRendering) {
      return;
    }
    const prev = this.renderer.uniforms["iCurrentCursor"]?.value
      ? this.renderer.uniforms["iCurrentCursor"].value[0]
      : cursor.getUniformData();

    const iTime = this.renderer.uniforms["iTime"];
    if (prev) {
      this.renderer.setUniform("iPreviousCursor", ...prev);
    }
    this.renderer.setUniform("iCurrentCursor", ...cursor.getUniformData());
    if (iTime) {
      let now = iTime.value[0][0];
      this.renderer.setUniform("iTimeCursorChange", now);
    }
  }
}

export { ShaderPlayer };
