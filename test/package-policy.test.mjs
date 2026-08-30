import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFiles = [
  "extensions/index.ts",
  "skills/svw-waveform/SKILL.md",
  "README.md",
  "package.json",
  "scripts/install-svw.mjs"
];

test("public package excludes private identifiers", async () => {
  for (const file of publicFiles) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /maxiao|mxlol233|outlook\.com|\bmxv\b/i, file);
  }
});
