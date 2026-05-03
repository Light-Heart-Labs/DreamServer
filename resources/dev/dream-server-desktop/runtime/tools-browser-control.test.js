const assert = require("assert/strict");
const { executeTool } = require("./tools");

async function testBrowserControlUsesActiveWorkbenchWhenUrlIsOmitted() {
  let harnessCommand = null;
  const result = await executeTool(
    { type: "browser_control", operation: "snapshot" },
    {
      fullAccessMode: true,
      previewHarness: async (command) => {
        harnessCommand = command;
        return {
          url: "http://127.0.0.1:4173",
          title: "Preview",
          textLength: 32,
          visibleElements: 4,
          viewport: { width: 1365, height: 900 },
          textPreview: "Preview ativo"
        };
      }
    }
  );

  assert.equal(harnessCommand.command, "snapshot");
  assert.equal(harnessCommand.url, "");
  assert.match(result, /BROWSER CONTROL PASSED \(WORKBENCH LIVE\)/);
  assert.match(result, /URL: http:\/\/127\.0\.0\.1:4173/);
}

async function testBrowserControlStillNavigatesWhenUrlIsProvided() {
  let harnessCommand = null;
  await executeTool(
    { type: "browser_control", url: "http://127.0.0.1:4173" },
    {
      fullAccessMode: true,
      previewHarness: async (command) => {
        harnessCommand = command;
        return { url: command.url, textLength: 1, visibleElements: 1 };
      }
    }
  );

  assert.equal(harnessCommand.command, "goto");
  assert.equal(harnessCommand.url, "http://127.0.0.1:4173");
}

async function testBrowserControlConvertsTopLevelOperationToWorkbenchStep() {
  let harnessCommand = null;
  await executeTool(
    { type: "browser_control", operation: "click", selector: "#start-game" },
    {
      fullAccessMode: true,
      previewHarness: async (command) => {
        harnessCommand = command;
        return {
          url: "http://127.0.0.1:4173",
          textLength: 10,
          visibleElements: 2,
          stepResults: ["1. click ok: #start-game"]
        };
      }
    }
  );

  assert.equal(harnessCommand.command, "sequence");
  assert.deepEqual(harnessCommand.steps, [{ type: "click", selector: "#start-game" }]);
  assert.equal(harnessCommand.url, "");
}

async function main() {
  await testBrowserControlUsesActiveWorkbenchWhenUrlIsOmitted();
  console.log("ok - testBrowserControlUsesActiveWorkbenchWhenUrlIsOmitted");
  await testBrowserControlStillNavigatesWhenUrlIsProvided();
  console.log("ok - testBrowserControlStillNavigatesWhenUrlIsProvided");
  await testBrowserControlConvertsTopLevelOperationToWorkbenchStep();
  console.log("ok - testBrowserControlConvertsTopLevelOperationToWorkbenchStep");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
