import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("svw release dispatch is gated, immutable, and tokenless", () => {
  assert.match(workflow, /repository_dispatch:\n\s+types: \[svw-release-published\]/);
  assert.match(workflow, /node scripts\/prepare-svw-release\.mjs/);
  assert.match(workflow, /npm run bootstrap/);
  assert.match(workflow, /npm run smoke:pi/);
  assert.match(workflow, /git tag -a/);
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN:\s*\$\{\{/);
});
