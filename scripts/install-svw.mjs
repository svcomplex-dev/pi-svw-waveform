#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(packageRoot, "scripts", "install-svw.sh");
const versionPattern = /^(?:latest|(?:release-)?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;

export function buildInstallArguments(platform, arch, root, version) {
  if (!versionPattern.test(version)) {
    throw new Error("SVW_PI_VERSION must be latest, X.Y.Z, or release-X.Y.Z");
  }
  if (platform === "linux" && arch === "x64") {
    return [
      "--version",
      version,
      "--bin-dir",
      join(root, "vendor", "bin"),
      "--install-root",
      join(root, "vendor", "packages"),
      "--no-modify-path"
    ];
  }
  if (platform === "darwin" && arch === "arm64") {
    return ["--version", version];
  }
  throw new Error(`unsupported platform: ${platform} ${arch}; supported: Linux x64 and macOS arm64`);
}

export function installedBinaryCandidates(platform, root) {
  if (platform === "linux") {
    return [join(root, "vendor", "bin", "svw")];
  }
  return ["/opt/homebrew/bin/svw", "/usr/local/bin/svw", "svw"];
}

export function installSvw({
  platform = process.platform,
  arch = process.arch,
  root = packageRoot,
  version = process.env.SVW_PI_VERSION || "latest",
  spawn = spawnSync
} = {}) {
  if (process.env.SVW_PI_SKIP_INSTALL === "1") {
    process.stdout.write("Skipping svw bootstrap because SVW_PI_SKIP_INSTALL=1\n");
    return;
  }
  const args = buildInstallArguments(platform, arch, root, version);
  const result = spawn("sh", [installer, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`svw installer exited with status ${result.status}`);
  }
  const binary = installedBinaryCandidates(platform, root).find(
    (candidate) => candidate === "svw" || existsSync(candidate)
  );
  if (!binary) {
    throw new Error("svw installer completed without an executable candidate");
  }
  const smoke = spawn(binary, ["--version"], { cwd: root, encoding: "utf8" });
  if (smoke.error || smoke.status !== 0) {
    throw smoke.error || new Error(`svw smoke test exited with status ${smoke.status}`);
  }
  process.stdout.write(`Pi package is ready with ${smoke.stdout.trim()}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installSvw();
}
