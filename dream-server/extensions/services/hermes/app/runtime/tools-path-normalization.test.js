const assert = require("assert/strict");
const os = require("os");
const path = require("path");
const { expandPathInput, resolveOpenUrlTarget } = require("./tools");

function testHomePathExpansion() {
  const resolved = expandPathInput("~/ThreeJS-Shooter/index.html", process.cwd());
  assert.equal(resolved, path.join(os.homedir(), "ThreeJS-Shooter", "index.html"));
}

function testBrokenFileUrlIsTreatedAsRelativeFile() {
  const workspaceRoot = path.join(os.tmpdir(), "dream-workspace");
  const target = resolveOpenUrlTarget("file://shooter_game.html", workspaceRoot);
  assert.equal(target.kind, "file");
  assert.equal(target.value, path.join(workspaceRoot, "shooter_game.html"));
  assert.match(target.display, /^file:\/\//);
  assert.ok(!target.value.endsWith(`${path.sep}`));
}

function testRelativePathWithExtensionCanOpenAsFile() {
  const workspaceRoot = path.join(os.tmpdir(), "dream-workspace");
  const target = resolveOpenUrlTarget("index.html", workspaceRoot);
  assert.equal(target.kind, "file");
  assert.equal(target.value, path.join(workspaceRoot, "index.html"));
}

function main() {
  testHomePathExpansion();
  console.log("ok - testHomePathExpansion");
  testBrokenFileUrlIsTreatedAsRelativeFile();
  console.log("ok - testBrokenFileUrlIsTreatedAsRelativeFile");
  testRelativePathWithExtensionCanOpenAsFile();
  console.log("ok - testRelativePathWithExtensionCanOpenAsFile");
}

main();
