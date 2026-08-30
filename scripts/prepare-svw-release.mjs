#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const releasePattern = /^release-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const packageVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const integrationMembers = {
  "extensions/index.ts": "share/svw/agents/pi-extension/index.ts",
  "skills/svw-waveform/SKILL.md": "share/svw/agents/skills/svw-waveform/SKILL.md"
};

function parseRelease(tag) {
  const match = releasePattern.exec(tag);
  if (!match) throw new Error("svw release must be release-MAJOR.MINOR.PATCH");
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nextPatch(version) {
  const match = packageVersionPattern.exec(version);
  if (!match) throw new Error("package version must be MAJOR.MINOR.PATCH");
  const patch = Number(match[3]) + 1;
  if (!Number.isSafeInteger(patch)) throw new Error("package patch version overflow");
  return `${match[1]}.${match[2]}.${patch}`;
}

function validatePackageState(packageManifest, packageLock) {
  if (packageManifest.name !== "pi-svw-waveform" || packageLock.name !== packageManifest.name) {
    throw new Error("unexpected npm package identity");
  }
  if (packageLock.version !== packageManifest.version ||
      packageLock.packages?.[""]?.version !== packageManifest.version) {
    throw new Error("package.json and package-lock.json versions differ");
  }
  nextPatch(packageManifest.version);
}

function validateSource(source, releaseTag) {
  if (source?.release !== releaseTag) throw new Error("integration source release differs");
  for (const platform of ["linux-x64", "macos-arm64"]) {
    const expectedAsset = `svw-${releaseTag}-${platform}.tar.gz`;
    if (source.assets?.[platform]?.asset !== expectedAsset ||
        !/^[0-9a-f]{64}$/.test(source.assets?.[platform]?.archiveSha256 ?? "")) {
      throw new Error(`integration source asset is invalid: ${platform}`);
    }
  }
  for (const path of Object.keys(integrationMembers)) {
    if (!/^[0-9a-f]{64}$/.test(source.files?.[path] ?? "")) {
      throw new Error(`integration source hash is invalid: ${path}`);
    }
  }
}

export function isOlderRelease(packageManifest, releaseTag) {
  const requested = parseRelease(releaseTag);
  if (!packageManifest.svwRelease || packageManifest.svwRelease === "latest") return false;
  return compareVersions(requested, parseRelease(packageManifest.svwRelease)) < 0;
}

export function prepareRelease(packageManifest, packageLock, releaseTag,
                               currentSource, desiredSource) {
  parseRelease(releaseTag);
  validatePackageState(packageManifest, packageLock);
  if (isOlderRelease(packageManifest, releaseTag)) {
    return {
      changed: false,
      packageVersion: packageManifest.version,
      releaseTag: packageManifest.svwRelease
    };
  }
  validateSource(desiredSource, releaseTag);
  const sourceMatches = currentSource !== null &&
    JSON.stringify(currentSource) === JSON.stringify(desiredSource);
  if (packageManifest.svwRelease === releaseTag && sourceMatches) {
    return { changed: false, packageVersion: packageManifest.version, releaseTag };
  }

  const version = nextPatch(packageManifest.version);
  packageManifest.version = version;
  packageManifest.svwRelease = releaseTag;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  return { changed: true, packageVersion: version, releaseTag };
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function archiveMembers(archive) {
  const listing = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  }).split("\n").filter(Boolean);
  for (const entry of listing) {
    if (entry.startsWith("/") || entry.replace(/^\.\//, "").split("/").includes("..")) {
      throw new Error("SVW archive contains an unsafe path");
    }
  }
  return listing;
}

function extractRegular(archive, listing, wanted) {
  const matches = listing.filter((entry) => entry.replace(/^\.\//, "") === wanted);
  if (matches.length !== 1) throw new Error(`SVW archive must contain exactly one ${wanted}`);
  const verbose = execFileSync("tar", ["-tvzf", archive, matches[0]], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (!verbose.startsWith("-")) throw new Error(`${wanted} must be a regular file`);
  return execFileSync("tar", ["-xOzf", archive, matches[0]], {
    maxBuffer: 2 * 1024 * 1024
  });
}

async function importPlatform(releaseTag, platform, directory) {
  const asset = `svw-${releaseTag}-${platform}.tar.gz`;
  const base = (process.env.SVW_RELEASE_BASE_URL ||
    "https://github.com/svcomplex-dev/svw/releases/download").replace(/\/$/, "");
  const archiveBytes = await download(`${base}/${releaseTag}/${asset}`);
  const sidecar = (await download(`${base}/${releaseTag}/${asset}.sha256`)).toString("utf8").trim();
  const match = /^([0-9a-f]{64})[ \t]+(\S+)$/.exec(sidecar);
  if (!match || match[2] !== asset) throw new Error(`invalid checksum sidecar for ${asset}`);
  const archiveSha256 = sha256(archiveBytes);
  if (archiveSha256 !== match[1]) throw new Error(`archive SHA256 mismatch for ${asset}`);
  const archive = join(directory, asset);
  await writeFile(archive, archiveBytes);
  const listing = archiveMembers(archive);
  const files = Object.fromEntries(Object.entries(integrationMembers).map(([path, member]) =>
    [path, extractRegular(archive, listing, member)]));
  return { asset, archiveSha256, files };
}

export async function importReleaseIntegration(releaseTag) {
  parseRelease(releaseTag);
  const directory = await mkdtemp(join(tmpdir(), "pi-svw-release-"));
  try {
    const linux = await importPlatform(releaseTag, "linux-x64", directory);
    const macos = await importPlatform(releaseTag, "macos-arm64", directory);
    for (const path of Object.keys(integrationMembers)) {
      if (!linux.files[path].equals(macos.files[path])) {
        throw new Error(`platform integration differs: ${path}`);
      }
    }
    return {
      contents: linux.files,
      source: {
        release: releaseTag,
        assets: {
          "linux-x64": { asset: linux.asset, archiveSha256: linux.archiveSha256 },
          "macos-arm64": { asset: macos.asset, archiveSha256: macos.archiveSha256 }
        },
        files: Object.fromEntries(Object.keys(integrationMembers).map((path) =>
          [path, sha256(linux.files[path])]))
      }
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readCurrentSource(root) {
  try {
    const source = JSON.parse(await readFile(join(root, "svw-source.json"), "utf8"));
    for (const path of Object.keys(integrationMembers)) {
      const content = await readFile(join(root, path));
      if (sha256(content) !== source.files?.[path]) return null;
    }
    return source;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeOutputs(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  const output = `changed=${result.changed}\npackage_version=${result.packageVersion}\n` +
    `svw_release=${result.releaseTag}\n`;
  await appendFile(process.env.GITHUB_OUTPUT, output);
}

async function main() {
  const releaseTag = process.argv[2] || "";
  const root = process.cwd();
  const packageManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  parseRelease(releaseTag);
  validatePackageState(packageManifest, packageLock);

  if (isOlderRelease(packageManifest, releaseTag)) {
    const result = prepareRelease(packageManifest, packageLock, releaseTag, null, {
      release: releaseTag,
      files: Object.fromEntries(Object.keys(integrationMembers).map((path) => [path, "0".repeat(64)]))
    });
    await writeOutputs(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const imported = await importReleaseIntegration(releaseTag);
  const currentSource = await readCurrentSource(root);
  const result = prepareRelease(packageManifest, packageLock, releaseTag,
    currentSource, imported.source);
  if (result.changed) {
    await writeFile(join(root, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
    await writeFile(join(root, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`);
    for (const [path, content] of Object.entries(imported.contents)) {
      await writeFile(join(root, path), content);
    }
    await writeFile(join(root, "svw-source.json"), `${JSON.stringify(imported.source, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT) {
      execFileSync("git", ["add", "package.json", "package-lock.json", "extensions/index.ts",
        "skills/svw-waveform/SKILL.md", "svw-source.json"], { cwd: root });
    }
  }
  await writeOutputs(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
