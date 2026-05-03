const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { ToolRuntime } = require("./tool-runtime");
const { createToolRegistry } = require("../tool-registry");

async function testSuccessfulExecutionNormalizesResult() {
  const registry = createToolRegistry([
    {
      name: "read_file",
      description: "Read file.",
      permissionClass: "safe",
      supportedSurfaces: ["desktop"],
      inputSchema: { type: "object", properties: {} }
    }
  ]);
  const runtime = new ToolRuntime({
    registry,
    executeTool: async () => "ok"
  });
  const result = await runtime.execute({ type: "read_file" }, {});
  assert.equal(result.ok, true);
  assert.equal(result.result, "ok");
  assert.equal(result.structuredResult.tool, "read_file");
  assert.equal(result.structuredResult.toolset, "filesystem");
}

async function testFailureReturnsRepairHints() {
  const registry = createToolRegistry([
    {
      name: "run_command",
      description: "Run command.",
      permissionClass: "system-write",
      supportedSurfaces: ["desktop"],
      inputSchema: { type: "object", properties: {} }
    }
  ]);
  const runtime = new ToolRuntime({
    registry,
    executeTool: async () => {
      throw new Error("ModuleNotFoundError: No module named 'openpyxl'");
    }
  });
  const result = await runtime.execute({ type: "run_command" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.structuredResult.errorType, "missing_python_module");
  assert.ok(result.structuredResult.repairHints.some((hint) => hint.includes("openpyxl")));
}

async function testLargeOutputPersistsToDisk() {
  const resultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dream-tool-runtime-test-"));
  const registry = createToolRegistry([
    {
      name: "run_command",
      description: "Run command.",
      permissionClass: "system-write",
      supportedSurfaces: ["desktop"],
      inputSchema: { type: "object", properties: {} }
    }
  ]);
  const runtime = new ToolRuntime({
    registry,
    resultRoot,
    resultThreshold: 10,
    previewChars: 20,
    executeTool: async () => "x".repeat(120)
  });
  const result = await runtime.execute({ type: "run_command" }, { actionKey: "test-action" });
  assert.equal(result.ok, true);
  assert.match(String(result.result), /<persisted-output>/);
  assert.match(String(result.result), /Full output saved to:/);
  const files = await fs.readdir(resultRoot);
  assert.equal(files.length, 1);
}

async function main() {
  await testSuccessfulExecutionNormalizesResult();
  await testFailureReturnsRepairHints();
  await testLargeOutputPersistsToDisk();
  console.log("tool-runtime platform tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
