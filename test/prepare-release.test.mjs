import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importReleaseIntegration, prepareRelease } from "../scripts/prepare-svw-release.mjs";

function state(version = "0.1.6", svwRelease = "latest") {
  return [
    { name: "pi-svw-waveform", version, svwRelease },
    { name: "pi-svw-waveform", version, packages: { "": { version } } }
  ];
}

function source(release = "release-0.1.0", suffix = "a") {
  return {
    release,
    assets: Object.fromEntries(["linux-x64", "macos-arm64"].map((platform) => [platform, {
      asset: `svw-${release}-${platform}.tar.gz`,
      archiveSha256: suffix.repeat(64)
    }])),
    files: {
      "extensions/index.ts": suffix.repeat(64),
      "skills/svw-waveform/SKILL.md": suffix.repeat(64)
    }
  };
}

async function archiveFixture(root, release, platform, skill) {
  const payload = join(root, `${platform}-payload`);
  await mkdir(join(payload, "share/svw/agents/pi-extension"), { recursive: true });
  await mkdir(join(payload, "share/svw/agents/skills/svw-waveform"), { recursive: true });
  await writeFile(join(payload, "share/svw/agents/pi-extension/index.ts"), "export const fixture = 1;\n");
  await writeFile(join(payload, "share/svw/agents/skills/svw-waveform/SKILL.md"), skill);
  const asset = `svw-${release}-${platform}.tar.gz`;
  const archive = join(root, asset);
  execFileSync("tar", ["-czf", archive, "-C", payload, "."]);
  const bytes = await readFile(archive);
  return { asset, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}

async function withReleaseServer(assets, callback) {
  const server = createServer((request, response) => {
    const name = request.url.split("/").pop();
    const sidecar = name.endsWith(".sha256");
    const asset = assets.find((item) => item.asset === (sidecar ? name.slice(0, -7) : name));
    if (!asset) { response.writeHead(404).end(); return; }
    response.writeHead(200, { Connection: "close" });
    response.end(sidecar ? `${asset.sha}  ${asset.asset}\n` : asset.bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.SVW_RELEASE_BASE_URL;
  process.env.SVW_RELEASE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try { return await callback(); } finally {
    if (previous === undefined) delete process.env.SVW_RELEASE_BASE_URL;
    else process.env.SVW_RELEASE_BASE_URL = previous;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("a new svw release advances the package patch and pins the release", () => {
  const [manifest, lock] = state();
  assert.deepEqual(prepareRelease(manifest, lock, "release-0.1.0", null, source()), {
    changed: true,
    packageVersion: "0.1.7",
    releaseTag: "release-0.1.0"
  });
  assert.equal(manifest.version, "0.1.7");
  assert.equal(manifest.svwRelease, "release-0.1.0");
  assert.equal(lock.version, "0.1.7");
  assert.equal(lock.packages[""].version, "0.1.7");
});

test("an exact duplicate does not create another package version", () => {
  const [manifest, lock] = state("0.1.7", "release-1.2.3");
  const current = source("release-1.2.3");
  assert.equal(prepareRelease(manifest, lock, "release-1.2.3", current, current).changed, false);
  assert.deepEqual(prepareRelease(manifest, lock, "release-1.2.2", current,
    source("release-1.2.2")), {
    changed: false,
    packageVersion: "0.1.7",
    releaseTag: "release-1.2.3"
  });
});

test("same-release integration drift creates a recoverable patch version", () => {
  const [manifest, lock] = state("0.1.9", "release-0.1.2");
  const result = prepareRelease(manifest, lock, "release-0.1.2",
    source("release-0.1.2", "a"), source("release-0.1.2", "b"));
  assert.equal(result.changed, true);
  assert.equal(result.packageVersion, "0.1.10");
});

test("malformed releases and inconsistent lockfiles are rejected", () => {
  const [manifest, lock] = state();
  assert.throws(() => prepareRelease(manifest, lock, "latest", null, source()), /release-MAJOR/);
  lock.version = "0.1.5";
  assert.throws(() => prepareRelease(manifest, lock, "release-0.1.0", null, source()), /versions differ/);
});

test("imports only checksum-verified, platform-identical integration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-release-test-"));
  try {
    const release = "release-1.2.3";
    const assets = await Promise.all(["linux-x64", "macos-arm64"].map((platform) =>
      archiveFixture(root, release, platform, "# exact skill\n")));
    const imported = await withReleaseServer(assets, () => importReleaseIntegration(release));
    assert.equal(imported.contents["skills/svw-waveform/SKILL.md"].toString(), "# exact skill\n");
    assert.equal(imported.source.assets["linux-x64"].archiveSha256, assets[0].sha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects integration drift between release platforms", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-release-test-"));
  try {
    const release = "release-1.2.3";
    const assets = await Promise.all([
      archiveFixture(root, release, "linux-x64", "# linux\n"),
      archiveFixture(root, release, "macos-arm64", "# macos\n")
    ]);
    await assert.rejects(withReleaseServer(assets, () => importReleaseIntegration(release)),
      /platform integration differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an archive whose checksum sidecar does not match", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-release-test-"));
  try {
    const release = "release-1.2.3";
    const assets = await Promise.all(["linux-x64", "macos-arm64"].map((platform) =>
      archiveFixture(root, release, platform, "# exact skill\n")));
    assets[0].sha = "0".repeat(64);
    await assert.rejects(withReleaseServer(assets, () => importReleaseIntegration(release)),
      /archive SHA256 mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
