#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const releasePattern = /^release-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const packageVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function parseRelease(tag) {
  const match = releasePattern.exec(tag);
  if (!match) {
    throw new Error("svw release must be release-MAJOR.MINOR.PATCH");
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

export function prepareRelease(packageManifest, packageLock, releaseTag) {
  const requestedRelease = parseRelease(releaseTag);
  if (packageManifest.name !== "pi-svw-waveform" || packageLock.name !== packageManifest.name) {
    throw new Error("unexpected npm package identity");
  }
  if (packageLock.version !== packageManifest.version || packageLock.packages?.[""]?.version !== packageManifest.version) {
    throw new Error("package.json and package-lock.json versions differ");
  }
  const packageVersion = packageVersionPattern.exec(packageManifest.version);
  if (!packageVersion) {
    throw new Error("package version must be MAJOR.MINOR.PATCH");
  }

  if (packageManifest.svwRelease === releaseTag) {
    return { changed: false, packageVersion: packageManifest.version, releaseTag };
  }
  if (packageManifest.svwRelease && packageManifest.svwRelease !== "latest") {
    const currentRelease = parseRelease(packageManifest.svwRelease);
    if (compareVersions(requestedRelease, currentRelease) < 0) {
      return {
        changed: false,
        packageVersion: packageManifest.version,
        releaseTag: packageManifest.svwRelease
      };
    }
  }

  const nextPatch = Number(packageVersion[3]) + 1;
  if (!Number.isSafeInteger(nextPatch)) {
    throw new Error("package patch version overflow");
  }
  const nextVersion = `${packageVersion[1]}.${packageVersion[2]}.${nextPatch}`;
  packageManifest.version = nextVersion;
  packageManifest.svwRelease = releaseTag;
  packageLock.version = nextVersion;
  packageLock.packages[""].version = nextVersion;
  return { changed: true, packageVersion: nextVersion, releaseTag };
}

async function main() {
  const releaseTag = process.argv[2] || "";
  const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
  const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const result = prepareRelease(packageManifest, packageLock, releaseTag);
  if (result.changed) {
    await writeFile("package.json", `${JSON.stringify(packageManifest, null, 2)}\n`);
    await writeFile("package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\npackage_version=${result.packageVersion}\nsvw_release=${result.releaseTag}\n`
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
