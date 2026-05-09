const assert = require("assert");
const { buildPreflight } = require("../src/main/installer/preflight");

function profile(overrides = {}) {
  return {
    os: "win32",
    arch: "x64",
    ramGB: 16,
    diskFreeGB: 80,
    gpuVendor: "nvidia",
    gpuModel: "RTX test",
    vramGB: 8,
    dockerAvailable: false,
    dockerComposeAvailable: false,
    wsl2Available: false,
    powershellAvailable: true,
    nvidiaSmiAvailable: true,
    ports: [],
    ...overrides
  };
}

let result = buildPreflight(profile());
assert.strictEqual(result.status, "warning");
assert.ok(result.requirements.some((item) => item.id === "docker" && item.status === "warning"));
assert.ok(result.requirements.some((item) => item.id === "wsl2" && item.status === "warning"));

result = buildPreflight(profile({ dockerAvailable: true, dockerComposeAvailable: true, wsl2Available: true }));
assert.notStrictEqual(result.status, "blocked");

result = buildPreflight(profile({ ramGB: 4, dockerAvailable: true, dockerComposeAvailable: true, wsl2Available: true }));
assert.ok(result.requirements.some((item) => item.id === "ram" && item.status === "required"));

result = buildPreflight(profile({ ports: [{ port: 11435, occupied: true }], dockerAvailable: true, dockerComposeAvailable: true, wsl2Available: true }));
assert.ok(result.requirements.some((item) => item.id === "port-11435" && item.status === "warning"));

result = buildPreflight(profile({ dockerAvailable: false, dockerComposeAvailable: false }), { mode: "cloud" });
assert.ok(!result.requirements.some((item) => item.id === "docker" && item.status === "required"));

console.log("installer preflight tests passed");
