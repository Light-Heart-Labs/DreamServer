const assert = require("assert/strict");
const os = require("os");
const path = require("path");
const { expandPathInput, normalizePathText, resolveOpenUrlTarget } = require("./tools");
const { maybeWindowsToWslPath, nativeWindowsPosixProblem } = require("./platform");

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

function testPrivateUseWindowsPathGlyphsAreNormalized() {
  const raw = "C\uF03A\uF05CUsers\uF05CGabriel\uF05CDocuments\uF05CDreamServerProjects\uF05Csnake\uF05Cindex.html";
  assert.equal(
    normalizePathText(raw),
    "C:\\Users\\Gabriel\\Documents\\DreamServerProjects\\snake\\index.html"
  );
  const resolved = expandPathInput(raw, path.join(os.tmpdir(), "dream-workspace"));
  assert.ok(!resolved.includes("\uF03A"));
  assert.ok(!resolved.includes("\uF05C"));
}

function testWindowsPosixDrivePathsAreNormalized() {
  if (process.platform !== "win32") {
    return;
  }
  const expected = "C:\\Users\\Gabriel\\Documents\\DreamServerProjects\\snake\\index.html";
  assert.equal(normalizePathText("/c/Users/Gabriel/Documents/DreamServerProjects/snake/index.html"), expected);
  assert.equal(normalizePathText("/mnt/c/Users/Gabriel/Documents/DreamServerProjects/snake/index.html"), expected);
  const resolved = expandPathInput("/c/Users/Gabriel/Documents/DreamServerProjects/snake/index.html", "C:\\tmp\\workspace");
  assert.equal(resolved, path.normalize(expected));
}

function testWindowsDoesNotExposeWslPathsByDefault() {
  if (process.platform !== "win32") {
    return;
  }
  const previous = process.env.DREAM_EXPOSE_WSL_PATHS;
  delete process.env.DREAM_EXPOSE_WSL_PATHS;
  try {
    assert.equal(maybeWindowsToWslPath("C:\\Users\\Gabriel\\Documents\\Project"), "");
    assert.match(
      nativeWindowsPosixProblem({ script: "cd /mnt/c/Users/Gabriel" }),
      /Windows nativo/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.DREAM_EXPOSE_WSL_PATHS;
    } else {
      process.env.DREAM_EXPOSE_WSL_PATHS = previous;
    }
  }
}

function main() {
  testHomePathExpansion();
  console.log("ok - testHomePathExpansion");
  testBrokenFileUrlIsTreatedAsRelativeFile();
  console.log("ok - testBrokenFileUrlIsTreatedAsRelativeFile");
  testRelativePathWithExtensionCanOpenAsFile();
  console.log("ok - testRelativePathWithExtensionCanOpenAsFile");
  testPrivateUseWindowsPathGlyphsAreNormalized();
  console.log("ok - testPrivateUseWindowsPathGlyphsAreNormalized");
  testWindowsPosixDrivePathsAreNormalized();
  console.log("ok - testWindowsPosixDrivePathsAreNormalized");
  testWindowsDoesNotExposeWslPathsByDefault();
  console.log("ok - testWindowsDoesNotExposeWslPathsByDefault");
}

main();
