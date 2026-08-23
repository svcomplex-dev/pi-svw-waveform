#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pi = process.platform === "win32"
  ? join(root, "node_modules", ".bin", "pi.cmd")
  : join(root, "node_modules", ".bin", "pi");
const child = spawn(pi, ["--mode", "rpc", "--no-session", "-e", root], {
  cwd: root,
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"]
});

let buffer = "";
let settled = false;
const timer = setTimeout(() => finish(new Error("Pi RPC extension smoke timed out")), 30000);

function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  child.kill();
  if (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Pi RPC loaded the svw package successfully\n");
  }
}

child.on("error", finish);
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === "response" && message.command === "get_state") {
      finish(message.success ? undefined : new Error("Pi RPC get_state failed"));
    }
  }
});
child.on("exit", (code) => {
  if (!settled) finish(new Error(`Pi RPC exited before get_state with status ${code}`));
});
child.stdin.end('{"type":"get_state"}\n');
