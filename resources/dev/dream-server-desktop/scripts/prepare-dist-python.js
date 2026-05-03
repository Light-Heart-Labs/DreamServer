#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const args = [path.join(projectRoot, "scripts", "download-python.js")];

if (process.platform === "darwin") {
  args.push("--platform=darwin", "--arch=arm64,x64");
}

const result = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: false
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
