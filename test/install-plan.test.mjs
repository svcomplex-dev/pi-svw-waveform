import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstallArguments,
  installedBinaryCandidates
} from "../scripts/install-svw.mjs";

test("Linux uses a package-private audited installation", () => {
  const args = buildInstallArguments("linux", "x64", "/pkg", "latest");
  assert.deepEqual(args, [
    "--version",
    "latest",
    "--bin-dir",
    "/pkg/vendor/bin",
    "--install-root",
    "/pkg/vendor/packages",
    "--no-modify-path"
  ]);
  assert.deepEqual(installedBinaryCandidates("linux", "/pkg"), ["/pkg/vendor/bin/svw"]);
});

test("macOS delegates to Homebrew without Linux layout overrides", () => {
  assert.deepEqual(buildInstallArguments("darwin", "arm64", "/pkg", "0.1.0"), [
    "--version",
    "0.1.0"
  ]);
  assert.deepEqual(installedBinaryCandidates("darwin", "/pkg"), [
    "/opt/homebrew/bin/svw",
    "/usr/local/bin/svw",
    "svw"
  ]);
});

test("rejects unsupported platforms and malformed versions", () => {
  assert.throws(() => buildInstallArguments("win32", "x64", "/pkg", "latest"), /unsupported platform/);
  assert.throws(() => buildInstallArguments("linux", "x64", "/pkg", "../latest"), /SVW_PI_VERSION/);
});
