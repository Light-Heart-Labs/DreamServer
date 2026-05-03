class CanvasGLSL {
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error("Canvas element is required");
    }

    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.vertexShader = null;
    this.fragmentShader = null;
    this.uniforms = {};
    this.attributes = {};
    this.animationId = null;
    this.startTime = null;
    this.lastFrameTime = null;
    this.accumulatedTime = 0;
    this.timeScale = 1.0;
    this.isRendering = false;

    this.textures = new Set();
    this.eventListeners = new Map();

    this.onError = options.onError || null;
    this.onSuccess = options.onSuccess || null;

    this.initWebGL();
    this.setupGeometry();
  }

  initWebGL() {
    this.gl =
      this.canvas.getContext("webgl2") || this.canvas.getContext("webgl");

    if (!this.gl) {
      throw new Error("WebGL not supported");
    }

    this.resizeCanvas();
    const resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
    });
    resizeObserver.observe(this.canvas);

    const contextLossHandler = () => {
      console.warn("WebGL context lost, attempting to restore...");
      this.handleContextLoss();
    };

    this.canvas.addEventListener("webglcontextlost", contextLossHandler);
    this.eventListeners.set("webglcontextlost", {
      element: this.canvas,
      handler: contextLossHandler,
      type: "webglcontextlost",
    });

    const contextRestoreHandler = () => {
      console.log("WebGL context restored");
      this.handleContextRestore();
    };
    this.canvas.addEventListener("webglcontextrestored", contextRestoreHandler);
    this.eventListeners.set("webglcontextrestored", {
      element: this.canvas,
      handler: contextRestoreHandler,
      type: "webglcontextrestored",
    });
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.program) {
      this.setUniform("iResolution", this.canvas.width, this.canvas.height);
    }
  }

  setupGeometry() {
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    this.vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
  }

  /**
   * Load and compile shader from GLSL code
   * @param {string} vertexSource - Vertex shader source code
   * @param {string} fragmentSource - Fragment shader source code
   * @returns {boolean} - Returns true if successful, false if error occurred
   */
  loadShader(vertexSource, fragmentSource) {
    // TODO: Add a default vertex
    if (!vertexSource || !fragmentSource) {
      const error = "Both vertex and fragment shader source are required";
      this.handleError(error, "VALIDATION_ERROR");
      return false;
    }

    this.cleanupShaderResources();

    try {
      this.vertexShader = this.compileShader(
        vertexSource,
        this.gl.VERTEX_SHADER,
      );

      this.fragmentShader = this.compileShader(
        fragmentSource,
        this.gl.FRAGMENT_SHADER,
      );

      this.program = this.gl.createProgram();
      this.gl.attachShader(this.program, this.vertexShader);
      this.gl.attachShader(this.program, this.fragmentShader);
      this.gl.linkProgram(this.program);

      if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
        const error = this.gl.getProgramInfoLog(this.program);
        this.gl.deleteProgram(this.program);
        this.program = null;
        this.handleError(error, "LINK_ERROR");
        return false;
      }

      this.setUniform("iResolution", this.canvas.width, this.canvas.height);
      this.setupAttributes();

      this.handleSuccess("Shader loaded and compiled successfully");
      return true;
    } catch (error) {
      this.handleError(error.message, error.type || "COMPILE_ERROR", {
        source: error.source,
        context: error.context,
      });
      return false;
    }
  }

  /**
   * Compile shader source codeu
   * @param {string} source - Shader source code
   * @param {number} type - Shader type (VERTEX_SHADER or FRAGMENT_SHADER)
   * @returns {WebGLShader} Compiled shader
   */
  compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const error = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      const errorObj = new Error(`Shader compilation failed: ${error}`);
      errorObj.type = "COMPILE_ERROR";
      errorObj.shaderType =
        type === this.gl.VERTEX_SHADER ? "vertex" : "fragment";
      errorObj.source = source;
      errorObj.context = this.getShaderErrorContext(error, source);
      throw errorObj;
    }

    return shader;
  }

  /**
   * Extracts shader error context
   * @param {string} raw log
   * @param {string} shaderSource - source code of the shader
   * @param {number} [context=5] - number of lines before/after the error to include
   * @returns {{ errorLine: number|null, lines: {lineNumber: number, code: string} }}
   */
  getShaderErrorContext(infoLog, shaderSource, context = 5) {
    const match = infoLog.match(/ERROR:\s*\d+:(\d+):/);
    if (!match) return { lineNumber: null, context: [] };

    const errorLine = parseInt(match[1], 10);
    const lines = shaderSource.split(/\r?\n/);
    const start = Math.max(0, errorLine - 1 - context);
    const end = Math.min(lines.length, errorLine + context);

    let contextLines = [];
    for (let i = start; i < end; i++) {
      contextLines.push({ lineNumber: i + 1, code: lines[i] });
    }

    return { errorLine, lines: contextLines };
  }

  /**
   * Handle error with callback or console logging
   * @param {string} message - Error message
   * @param {string} type - Error type
   * @param {Object} details - Additional error details
   */
  handleError(message, type, details = {}) {
    const errorInfo = {
      message,
      type,
      timestamp: new Date().toISOString(),
      ...details,
    };

    if (this.onError) {
      this.onError(errorInfo);
    } else {
      console.error(`[CanvasGLSL ${type}]`, message, details);
    }
  }

  /**
   * Handle success with callback or console logging
   * @param {string} message - Success message
   * @param {Object} details - Additional success details
   */
  handleSuccess(message, details = {}) {
    const successInfo = {
      message,
      timestamp: new Date().toISOString(),
      ...details,
    };

    if (this.onSuccess) {
      this.onSuccess(successInfo);
    } else {
      console.log(`[CanvasGLSL SUCCESS]`, message, details);
    }
  }

  setupAttributes() {
    this.attributes.position = this.gl.getAttribLocation(
      this.program,
      "position",
    );
  }

  // /**
  //  * Set uniform value
  //  * @param {string} name - Uniform name
  //  * @param {*} value - Uniform value (array, number, or texture)
  //  */
  setUniform(name, ...value) {
    let texture = value[0];
    if (texture instanceof WebGLTexture) {
      const gl = this.gl;
      // Count how many texture uniforms are already set
      const textureUnit = Object.keys(this.uniforms).filter(
        (key) => this.uniforms[key] instanceof WebGLTexture,
      ).length;

      if (this.program) {
        const location = gl.getUniformLocation(this.program, name);
        if (!location) {
          console.warn(`Uniform location not found for ${name}`);
          return;
        }

        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(location, textureUnit);
      }

      this.uniforms[name] = texture;
      return;
    } else {
      let u = {};
      u[name] = value;
      this.setUniforms(u);
    }
  }
  // setUniform(name, value) {
  //   const location = this.gl.getUniformLocation(this.program, name);
  //
  //   if (!location) {
  //     console.warn(`Uniform '${name}' not found in shader`);
  //     return;
  //   }
  //
  //   this.uniforms[name] = location;
  //
  //   this.gl.useProgram(this.program);
  //
  //   if (Array.isArray(value)) {
  //     switch (value.length) {
  //       case 1:
  //         this.gl.uniform1f(location, value[0]);
  //         break;
  //       case 2:
  //         this.gl.uniform2f(location, value[0], value[1]);
  //         break;
  //       case 3:
  //         this.gl.uniform3f(location, value[0], value[1], value[2]);
  //         break;
  //       case 4:
  //         this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
  //         break;
  //       default:
  //         console.warn(
  //           `Unsupported array length for uniform '${name}': ${value.length}`,
  //         );
  //     }
  //   } else if (typeof value === "number") {
  //     this.gl.uniform1f(location, value);
  //   } else if (value instanceof WebGLTexture) {
  //     // Handle texture uniforms
  //     const textureUnit = Object.keys(this.uniforms).filter(
  //       (key) => this.uniforms[key] instanceof WebGLTexture,
  //     ).length;
  //
  //     this.gl.activeTexture(this.gl.TEXTURE0 + textureUnit);
  //     this.gl.bindTexture(this.gl.TEXTURE_2D, value);
  //     this.gl.uniform1i(location, textureUnit);
  //   }
  // }
  //glslCanvas Copyright (c) 2015 Patricio Gonzalez Vivo (http://www.patriciogonzalezvivo.com) — MIT License
  setUniforms(uniforms) {
    let parsed = parseUniforms(uniforms);
    // Set each uniform
    for (let u in parsed) {
      if (parsed[u].type === "sampler2D") {
        // For textures, we need to track texture units, so we have a special setter
        // this.uniformTexture(parsed[u].name, parsed[u].value[0]);
        // this.loadTexture(parsed[u].name, parsed[u].value[0]);
      } else {
        this.uniform(
          parsed[u].method,
          parsed[u].type,
          parsed[u].name,
          parsed[u].value,
        );
      }
    }
    this.forceRender = true;
  }
  //glslCanvas Copyright (c) 2015 Patricio Gonzalez Vivo (http://www.patriciogonzalezvivo.com) — MIT License
  uniform(method, type, name, ...value) {
    // 'value' is a method-appropriate arguments list
    this.uniforms[name] = this.uniforms[name] || {};
    let uniform = this.uniforms[name];
    let change = isDiff(uniform.value, value);

    if (!this.program) {
      return;
    }
    // remember and keep track of uniforms location to save calls
    if (change || this.change || !uniform.location || !uniform.value) {
      uniform.name = name;
      uniform.type = type;
      uniform.value = value;
      uniform.method = "uniform" + method;
      this.gl.useProgram(this.program);
      uniform.location = this.gl.getUniformLocation(this.program, name);
      this.gl[uniform.method].apply(
        this.gl,
        [uniform.location].concat(uniform.value),
      );
      // If there is change update and there is buffer update manually one by one
      for (let key in this.buffers) {
        let buffer = this.buffers[key];
        this.gl.useProgram(buffer.program);
        let location = this.gl.getUniformLocation(buffer.program, name);
        this.gl[uniform.method].apply(
          this.gl,
          [location].concat(uniform.value),
        );
      }
    }
  }

  /**
   * Create texture from image source
   * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} source - Image source
   * @returns {WebGLTexture} WebGL texture
   */
  createTexture(source) {
    const texture = this.gl.createTexture();
    this.textures.add(texture); // Track texture for cleanup
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR,
    );

    return texture;
  }

  render() {
    if (!this.program) {
      console.warn("No shader program loaded");
      return;
    }

    this.gl.useProgram(this.program);

    // Set time uniform
    if (this.lastFrameTime === null) {
      this.lastFrameTime = performance.now();
    }
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000.0;
    this.lastFrameTime = now;
    
    this.accumulatedTime += dt * this.timeScale;
    this.setUniform("iTime", this.accumulatedTime);

    // Setup vertex attributes
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
    this.gl.enableVertexAttribArray(this.attributes.position);
    this.gl.vertexAttribPointer(
      this.attributes.position,
      2,
      this.gl.FLOAT,
      false,
      0,
      0,
    );
    // Draw
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  start() {
    if (this.isRendering) {
      return;
    }

    if (this.program) {
      this.isRendering = true;
      this.lastFrameTime = performance.now();

      const animate = () => {
        if (!this.isRendering) {
          return;
        }

        this.render();
        this.animationId = requestAnimationFrame(animate);
      };

      animate();
    }
  }

  stop() {
    this.isRendering = false;
    this.lastFrameTime = null;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  setTimeScale(scale) {
    this.timeScale = scale;
  }

  cleanupShaderResources() {
    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.vertexShader) {
      this.gl.deleteShader(this.vertexShader);
      this.vertexShader = null;
    }
    if (this.fragmentShader) {
      this.gl.deleteShader(this.fragmentShader);
      this.fragmentShader = null;
    }
    this.uniforms = {};
    this.attributes = {};
  }

  handleContextLoss() {
    this.stop();
    this.cleanupShaderResources();
    this.textures.clear();
    this.uniforms = {};
    this.attributes = {};
  }

  handleContextRestore() {
    this.initWebGL();
    this.setupGeometry();
    // Note: Shaders will need to be reloaded after context restore
  }

  dispose() {
    this.stop();

    this.cleanupShaderResources();

    this.textures.forEach((texture) => {
      this.gl.deleteTexture(texture);
    });
    this.textures.clear();

    if (this.vertexBuffer) {
      this.gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }

    this.eventListeners.forEach(({ element, handler, type }) => {
      element.removeEventListener(type, handler);
    });
    this.eventListeners.clear();

    this.uniforms = {};
    this.attributes = {};
    this.startTime = null;
  }
}

//glslCanvas Copyright (c) 2015 Patricio Gonzalez Vivo (http://www.patriciogonzalezvivo.com) — MIT License
export function parseUniforms(uniforms, prefix = null) {
  let parsed = [];

  for (let name in uniforms) {
    let uniform = uniforms[name];
    let u;

    if (prefix) {
      name = prefix + "." + name;
    }

    // Single float
    if (typeof uniform === "number") {
      parsed.push({
        type: "float",
        method: "1f",
        name,
        value: uniform,
      });
    }
    // Array: vector, array of floats, array of textures, or array of structs
    else if (Array.isArray(uniform)) {
      // Numeric values
      if (typeof uniform[0] === "number") {
        // float vectors (vec2, vec3, vec4)
        if (uniform.length === 1) {
          parsed.push({
            type: "float",
            method: "1f",
            name,
            value: uniform,
          });
        }
        // float vectors (vec2, vec3, vec4)
        else if (uniform.length >= 2 && uniform.length <= 4) {
          parsed.push({
            type: "vec" + uniform.length,
            method: uniform.length + "fv",
            name,
            value: uniform,
          });
        }
        // float array
        else if (uniform.length > 4) {
          parsed.push({
            type: "float[]",
            method: "1fv",
            name: name + "[0]",
            value: uniform,
          });
        }
        // TODO: assume matrix for (typeof == Float32Array && length == 16)?
      }
      // Array of textures
      else if (typeof uniform[0] === "string") {
        parsed.push({
          type: "sampler2D",
          method: "1i",
          name: name,
          value: uniform,
        });
      }
      // Array of arrays - but only arrays of vectors are allowed in this case
      else if (Array.isArray(uniform[0]) && typeof uniform[0][0] === "number") {
        // float vectors (vec2, vec3, vec4)
        if (uniform[0].length >= 2 && uniform[0].length <= 4) {
          // Set each vector in the array
          for (u = 0; u < uniform.length; u++) {
            parsed.push({
              type: "vec" + uniform[0].length,
              method: uniform[u].length + "fv",
              name: name + "[" + u + "]",
              value: uniform[u],
            });
          }
        }
        // else error?
      }
      // Array of structures
      else if (typeof uniform[0] === "object") {
        for (u = 0; u < uniform.length; u++) {
          // Set each struct in the array
          parsed.push(...parseUniforms(uniform[u], name + "[" + u + "]"));
        }
      }
    }
    // Boolean
    else if (typeof uniform === "boolean") {
      parsed.push({
        type: "bool",
        method: "1i",
        name,
        value: uniform,
      });
    }
    // Texture
    else if (typeof uniform === "string") {
      parsed.push({
        type: "sampler2D",
        method: "1i",
        name,
        value: uniform,
      });
    }
    // Structure
    else if (typeof uniform === "object") {
      // Set each field in the struct
      parsed.push(...parseUniforms(uniform, name));
    }
    // TODO: support other non-float types? (int, etc.)
  }
  return parsed;
}

export function isDiff(a, b) {
  if (a && b) {
    return a.toString() !== b.toString();
  }
  return false;
}
export { CanvasGLSL };
