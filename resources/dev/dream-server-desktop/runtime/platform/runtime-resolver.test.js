const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadResolver({ platform, arch, env = {}, electronApp = null }) {
  const filename = path.join(__dirname, "runtime-resolver.js");
  const code = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const wrapped = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, process) { ${code}\n})`,
    { filename }
  );

  const mockProcess = {
    ...process,
    platform,
    arch,
    env: { ...env }
  };

  wrapped(
    module.exports,
    (request) => {
      if (request === "electron") {
        return { app: electronApp };
      }
      return require(request);
    },
    module,
    filename,
    path.dirname(filename),
    mockProcess
  );

  return module.exports;
}

function testPackagedWindowsUsesUserDataVenvAndBundledPython() {
  const userData = path.join("C:", "Users", "gabriel", "AppData", "Roaming", "DreamServerHermesDesktop");
  const resolver = loadResolver({
    platform: "win32",
    arch: "x64",
    electronApp: {
      isPackaged: true,
      getPath(name) {
        if (name === "userData") {
          return userData;
        }
        throw new Error(`Unexpected path request: ${name}`);
      }
    }
  });

  assert.strictEqual(
    resolver.hermesVenvDir(),
    path.join(userData, "hermes", ".venv-hermes")
  );

  const runtimeCandidates = resolver.pythonCandidates();
  assert.strictEqual(runtimeCandidates[0].source, "venv:win32");
  assert.strictEqual(runtimeCandidates[1].source, "bundled:standalone-win32");
  assert.ok(
    runtimeCandidates[1].command.endsWith(
      path.join("resources", "python", "win32-x64", "python", "python.exe")
    )
  );

  const bootstrapCandidates = resolver.bootstrapPythonCandidates();
  assert.strictEqual(bootstrapCandidates[0].source, "bundled:standalone-win32");
}

function testEnvOverrideStaysFirst() {
  const resolver = loadResolver({
    platform: "darwin",
    arch: "arm64",
    env: {
      DREAM_HERMES_PYTHON: "/tmp/custom-python"
    },
    electronApp: {
      isPackaged: false,
      getPath() {
        return "/tmp/unused";
      }
    }
  });

  assert.strictEqual(resolver.pythonCandidates()[0].command, "/tmp/custom-python");
  assert.strictEqual(resolver.bootstrapPythonCandidates()[0].command, "/tmp/custom-python");
}

function testPackagedDarwinUsesBundledPython3() {
  const userData = path.join("/Users", "gabriel", "Library", "Application Support", "Dream Server");
  const resolver = loadResolver({
    platform: "darwin",
    arch: "arm64",
    electronApp: {
      isPackaged: true,
      getPath(name) {
        if (name === "userData") {
          return userData;
        }
        throw new Error(`Unexpected path request: ${name}`);
      }
    }
  });

  assert.strictEqual(
    resolver.hermesVenvDir(),
    path.join(userData, "hermes", ".venv-hermes")
  );

  const bootstrapCandidates = resolver.bootstrapPythonCandidates();
  assert.strictEqual(bootstrapCandidates[0].source, "bundled:standalone-python3");
  assert.ok(
    bootstrapCandidates[0].command.endsWith(
      path.join("resources", "python", "darwin-arm64", "python", "bin", "python3")
    )
  );
}

testPackagedWindowsUsesUserDataVenvAndBundledPython();
testEnvOverrideStaysFirst();
testPackagedDarwinUsesBundledPython3();
console.log("runtime resolver tests passed");
