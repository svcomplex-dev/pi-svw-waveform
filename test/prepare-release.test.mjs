import assert from "node:assert/strict";
import test from "node:test";
import { prepareRelease } from "../scripts/prepare-svw-release.mjs";

function state(version = "0.1.6", svwRelease = "latest") {
  return [
    { name: "pi-svw-waveform", version, svwRelease },
    { name: "pi-svw-waveform", version, packages: { "": { version } } }
  ];
}

test("a new svw release advances the package patch and pins the release", () => {
  const [manifest, lock] = state();
  assert.deepEqual(prepareRelease(manifest, lock, "release-0.1.0"), {
    changed: true,
    packageVersion: "0.1.7",
    releaseTag: "release-0.1.0"
  });
  assert.equal(manifest.version, "0.1.7");
  assert.equal(manifest.svwRelease, "release-0.1.0");
  assert.equal(lock.version, "0.1.7");
  assert.equal(lock.packages[""].version, "0.1.7");
});

test("duplicate and older dispatches do not create another package version", () => {
  const [manifest, lock] = state("0.1.7", "release-1.2.3");
  assert.equal(prepareRelease(manifest, lock, "release-1.2.3").changed, false);
  assert.deepEqual(prepareRelease(manifest, lock, "release-1.2.2"), {
    changed: false,
    packageVersion: "0.1.7",
    releaseTag: "release-1.2.3"
  });
});

test("malformed releases and inconsistent lockfiles are rejected", () => {
  const [manifest, lock] = state();
  assert.throws(() => prepareRelease(manifest, lock, "latest"), /release-MAJOR/);
  lock.version = "0.1.5";
  assert.throws(() => prepareRelease(manifest, lock, "release-0.1.0"), /versions differ/);
});
