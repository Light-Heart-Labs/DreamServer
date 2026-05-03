const { spawn } = require("child_process");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".dream-server", "mcp-servers.json");
const PROTOCOL_VERSION = "2024-11-05";

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

class McpConnection {
  constructor(server) {
    this.server = server;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
    this.tools = [];
    this.stderr = "";
  }

  async connect() {
    if (this.connected) {
      return;
    }

    this.child = spawn(this.server.command, this.server.args || [], {
      cwd: this.server.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...(this.server.env || {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout?.on("data", (chunk) => this._onStdout(chunk));
    this.child.stderr?.on("data", (chunk) => {
      this.stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      if (this.stderr.length > 12000) {
        this.stderr = this.stderr.slice(-8000);
      }
    });
    this.child.once("error", (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.connected = false;
    });
    this.child.once("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Servidor MCP ${this.server.name} foi encerrado.`));
      }
      this.pending.clear();
      this.connected = false;
    });

    const init = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "dream-server",
        version: "0.1.0"
      }
    });

    this.notify("notifications/initialized", {});
    this.connected = true;
    this.serverInfo = init?.serverInfo || null;
  }

  disconnect() {
    this.connected = false;
    try {
      this.child?.kill();
    } catch {}
    this.child = null;
  }

  _onStdout(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

    while (true) {
      const separator = this.buffer.indexOf("\r\n\r\n");
      if (separator < 0) {
        return;
      }

      const headerText = this.buffer.slice(0, separator).toString("utf8");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const length = Number(match[1]);
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) {
        return;
      }

      const payload = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);

      const message = safeJsonParse(payload, null);
      if (message) {
        this._handleMessage(message);
      }
    }
  }

  _handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(new Error(message.error.message || "Falha MCP."));
        return;
      }
      pending.resolve(message.result);
    }
  }

  _write(message) {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      ...message
    });
    const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
    this.child.stdin.write(header + payload);
  }

  notify(method, params) {
    this._write({
      method,
      params
    });
  }

  async request(method, params, timeoutMs = 15000) {
    const id = String(this.nextId++);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout aguardando ${method} do servidor MCP ${this.server.name}.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer
      });

      this._write({
        id,
        method,
        params
      });
    });
  }

  async listTools() {
    await this.connect();
    const response = await this.request("tools/list", {}, 15000);
    this.tools = Array.isArray(response?.tools) ? response.tools : [];
    return this.tools;
  }

  async callTool(name, args = {}) {
    await this.connect();
    return await this.request(
      "tools/call",
      {
        name,
        arguments: args
      },
      60000
    );
  }
}

class McpManager {
  constructor(configPath = DEFAULT_CONFIG_PATH) {
    this.configPath = configPath;
    this.loaded = false;
    this.config = {
      servers: []
    };
    this.connections = new Map();
  }

  async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    if (existsSync(this.configPath)) {
      const parsed = safeJsonParse(await fs.readFile(this.configPath, "utf8"), null);
      if (parsed?.servers && Array.isArray(parsed.servers)) {
        this.config = {
          servers: parsed.servers.map((server) => ({
            name: String(server.name || "").trim(),
            command: String(server.command || "").trim(),
            args: Array.isArray(server.args) ? server.args.map(String) : [],
            cwd: server.cwd ? String(server.cwd) : null,
            env: server.env && typeof server.env === "object" ? server.env : {}
          }))
        };
      }
    }

    this.loaded = true;
  }

  async saveConfig() {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
  }

  async addServer(server) {
    await this.ensureLoaded();
    const normalized = {
      name: String(server.name || "").trim(),
      command: String(server.command || "").trim(),
      args: Array.isArray(server.args) ? server.args.map(String) : [],
      cwd: server.cwd ? String(server.cwd) : null,
      env: server.env && typeof server.env === "object" ? server.env : {}
    };
    if (!normalized.name || !normalized.command) {
      throw new Error("Servidor MCP exige nome e comando.");
    }
    this.config.servers = this.config.servers.filter((entry) => entry.name !== normalized.name);
    this.config.servers.push(normalized);
    await this.saveConfig();
    return normalized;
  }

  async removeServer(name) {
    await this.ensureLoaded();
    this.disconnect(name);
    this.config.servers = this.config.servers.filter((entry) => entry.name !== name);
    await this.saveConfig();
  }

  findServer(name) {
    return this.config.servers.find((entry) => entry.name === name) || null;
  }

  async connect(name) {
    await this.ensureLoaded();
    const server = this.findServer(name);
    if (!server) {
      throw new Error(`Servidor MCP nao configurado: ${name}`);
    }

    let connection = this.connections.get(name);
    if (!connection) {
      connection = new McpConnection(server);
      this.connections.set(name, connection);
    }

    await connection.connect();
    await connection.listTools();
    return connection;
  }

  disconnect(name) {
    const connection = this.connections.get(name);
    if (connection) {
      connection.disconnect();
      this.connections.delete(name);
    }
  }

  async listTools(name) {
    const connection = await this.connect(name);
    return await connection.listTools();
  }

  async callTool(serverName, toolName, args = {}) {
    const connection = await this.connect(serverName);
    return await connection.callTool(toolName, args);
  }

  getState() {
    const configured = this.config.servers.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      cwd: server.cwd
    }));
    const connected = [...this.connections.entries()].map(([name, connection]) => ({
      name,
      connected: Boolean(connection.connected),
      tools: Array.isArray(connection.tools)
        ? connection.tools.map((tool) => tool.name || "tool")
        : [],
      stderrTail: connection.stderr.slice(-1500)
    }));

    return {
      configured,
      connected
    };
  }
}

module.exports = {
  McpManager
};
