#!/usr/bin/env node
"use strict";

const { ensureHermesVenv, needsSetup } = require("../runtime/hermes/setup");

async function main() {
  await ensureHermesVenv({
    onProgress(message) {
      process.stdout.write(`[setup-hermes] ${message}\n`);
    }
  });

  if (needsSetup()) {
    throw new Error("Hermes Agent ainda nao esta pronto apos o setup.");
  }

  process.stdout.write("[setup-hermes] Hermes Agent pronto.\n");
}

main().catch((error) => {
  process.stderr.write(`[setup-hermes] ERROR: ${error.message}\n`);
  process.exit(1);
});
