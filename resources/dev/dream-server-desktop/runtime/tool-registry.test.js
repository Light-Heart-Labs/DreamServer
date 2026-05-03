const assert = require("assert/strict");
const {
  createToolRegistry,
  inferRepairHints,
  inferToolset,
  normalizeToolResult
} = require("./tool-registry");

async function testToolsetsAreInferred() {
  assert.equal(inferToolset("terminal_exec"), "terminal");
  assert.equal(inferToolset("browser_control"), "browser");
  assert.equal(inferToolset("adb_shell"), "android");
  assert.equal(inferToolset("write_file"), "filesystem");
}

async function testRegistryFiltersLimitedAndUnavailableTools() {
  const registry = createToolRegistry(
    [
      {
        name: "open_url",
        description: "open",
        permissionClass: "network",
        supportedSurfaces: ["desktop"],
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "adb_shell",
        description: "adb",
        permissionClass: "system-write",
        supportedSurfaces: ["desktop"],
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "custom_internal",
        description: "custom",
        permissionClass: "system-write",
        supportedSurfaces: ["desktop"],
        inputSchema: { type: "object", properties: {} }
      }
    ],
    {
      limitedToolNames: new Set(["open_url"])
    }
  );

  assert.deepEqual(registry.list({ fullAccessMode: false }).map((tool) => tool.name), ["open_url"]);
  assert.ok(registry.getSupportedTools({ fullAccessMode: true }).some((tool) => tool.name === "custom_internal"));
  assert.ok(registry.getOpenAIToolSchemas({ fullAccessMode: true }).every((entry) => entry.type === "function"));
}

async function testStructuredToolResultIncludesRepairHints() {
  const result = normalizeToolResult(
    { type: "run_command" },
    false,
    "Traceback\nModuleNotFoundError: No module named 'openpyxl'"
  );

  assert.equal(result.ok, false);
  assert.equal(result.toolset, "terminal");
  assert.equal(result.errorType, "missing_python_module");
  assert.ok(result.repairHints.some((hint) => hint.includes("openpyxl")));
  assert.ok(inferRepairHints("spawn npm ENOENT").some((hint) => /PATH|executavel/i.test(hint)));
}

async function main() {
  await testToolsetsAreInferred();
  console.log("ok - testToolsetsAreInferred");
  await testRegistryFiltersLimitedAndUnavailableTools();
  console.log("ok - testRegistryFiltersLimitedAndUnavailableTools");
  await testStructuredToolResultIncludesRepairHints();
  console.log("ok - testStructuredToolResultIncludesRepairHints");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
