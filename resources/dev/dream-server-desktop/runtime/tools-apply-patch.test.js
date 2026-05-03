const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { executeTool } = require("./tools");

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dream-apply-patch-"));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testAppliesUnifiedPatchAndRollback() {
  await withTempWorkspace(async (root) => {
    const filePath = path.join(root, "sample.txt");
    await fs.writeFile(filePath, "one\ntwo\nthree", "utf8");

    const result = await executeTool(
      {
        type: "apply_patch",
        patch: [
          "--- a/sample.txt",
          "+++ b/sample.txt",
          "@@ -1,3 +1,3 @@",
          " one",
          "-two",
          "+TWO",
          " three"
        ].join("\n")
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    assert.equal(await fs.readFile(filePath, "utf8"), "one\nTWO\nthree");
    assert.match(result, /Patch aplicado/);
    const changeId = result.match(/changeId=([^\s]+)/)?.[1];
    assert.ok(changeId);

    await executeTool(
      {
        type: "file_rollback",
        changeId
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );
    assert.equal(await fs.readFile(filePath, "utf8"), "one\ntwo\nthree");
  });
}

async function testRejectsMismatchedPatchWithoutWriting() {
  await withTempWorkspace(async (root) => {
    const filePath = path.join(root, "sample.txt");
    await fs.writeFile(filePath, "alpha\nbeta", "utf8");

    await assert.rejects(
      () =>
        executeTool(
          {
            type: "apply_patch",
            patch: [
              "--- a/sample.txt",
              "+++ b/sample.txt",
              "@@ -1,2 +1,2 @@",
              " alpha",
              "-missing",
              "+patched"
            ].join("\n")
          },
          {
            workspaceRoot: root,
            fullAccessMode: true
          }
        ),
      /Patch nao casou/
    );

    assert.equal(await fs.readFile(filePath, "utf8"), "alpha\nbeta");
  });
}

async function testCreatesFileFromUnifiedPatch() {
  await withTempWorkspace(async (root) => {
    const filePath = path.join(root, "created.txt");
    await executeTool(
      {
        type: "apply_patch",
        patch: [
          "--- /dev/null",
          "+++ b/created.txt",
          "@@ -0,0 +1,2 @@",
          "+hello",
          "+world"
        ].join("\n")
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    assert.equal(await fs.readFile(filePath, "utf8"), "hello\nworld\n");
  });
}

async function main() {
  await testAppliesUnifiedPatchAndRollback();
  console.log("ok - testAppliesUnifiedPatchAndRollback");
  await testRejectsMismatchedPatchWithoutWriting();
  console.log("ok - testRejectsMismatchedPatchWithoutWriting");
  await testCreatesFileFromUnifiedPatch();
  console.log("ok - testCreatesFileFromUnifiedPatch");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
