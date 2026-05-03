#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const electronBinary = require("electron");
const projectRoot = path.resolve(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("error", (error) => {
  process.stderr.write(`[start-electron] ERROR: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
