import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

test("declares a discoverable Pi package", () => {
  assert.equal(manifest.name, "pi-svw-waveform");
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.match(manifest.svwRelease, /^(?:latest|release-\d+\.\d+\.\d+)$/);
  assert.deepEqual(manifest.pi.extensions, ["./extensions/index.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.match(manifest.pi.image, /^https:\/\/raw\.githubusercontent\.com\/svcomplex-dev\/svw\//);
});

test("uses Pi host packages as peers", () => {
  for (const name of [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox"
  ]) {
    assert.equal(manifest.peerDependencies[name], "*");
  }
});

test("ships the automatic svw bootstrap", () => {
  assert.equal(manifest.scripts.postinstall, "node ./scripts/install-svw.mjs");
  assert.ok(manifest.files.includes("scripts/install-svw.sh"));
  assert.ok(manifest.files.includes("scripts/install-svw.mjs"));
});
