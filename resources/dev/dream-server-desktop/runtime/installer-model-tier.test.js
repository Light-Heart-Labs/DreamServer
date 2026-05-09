const assert = require("assert");
const { recommendModel } = require("../src/main/installer/modelTier");

function profile(overrides = {}) {
  return {
    os: "linux",
    arch: "x64",
    ramGB: 32,
    diskFreeGB: 200,
    gpuVendor: "none",
    gpuModel: "CPU-only",
    vramGB: 0,
    unifiedMemoryGB: 0,
    dockerAvailable: true,
    wsl2Available: false,
    accelerationAvailable: false,
    ...overrides
  };
}

assert.strictEqual(recommendModel(profile({ gpuVendor: "nvidia", vramGB: 6 })).tier.id, "T1");
assert.strictEqual(recommendModel(profile({ gpuVendor: "nvidia", vramGB: 8 })).tier.id, "T1");
assert.strictEqual(recommendModel(profile({ gpuVendor: "nvidia", vramGB: 16 })).tier.id, "T2");
assert.strictEqual(recommendModel(profile({ gpuVendor: "nvidia", vramGB: 24, ramGB: 64 })).tier.id, "T3");
assert.strictEqual(recommendModel(profile({ gpuVendor: "nvidia", vramGB: 48, ramGB: 96 })).tier.id, "T4");
assert.strictEqual(recommendModel(profile({ os: "darwin", arch: "arm64", ramGB: 16, unifiedMemoryGB: 16, gpuVendor: "apple" })).tier.id, "T1");
assert.strictEqual(recommendModel(profile({ os: "darwin", arch: "arm64", ramGB: 32, unifiedMemoryGB: 32, gpuVendor: "apple" })).tier.id, "T2");
assert.strictEqual(recommendModel(profile({ os: "darwin", arch: "arm64", ramGB: 64, unifiedMemoryGB: 64, gpuVendor: "apple" })).tier.id, "T3");
assert.strictEqual(recommendModel(profile({ os: "darwin", arch: "arm64", ramGB: 128, unifiedMemoryGB: 128, gpuVendor: "apple" })).tier.id, "T4");
assert.strictEqual(recommendModel(profile({ ramGB: 8, diskFreeGB: 20 })).mode, "hybrid");
assert.strictEqual(recommendModel(profile({ ramGB: 4, diskFreeGB: 4 })).mode, "cloud");

console.log("installer model tier tests passed");
