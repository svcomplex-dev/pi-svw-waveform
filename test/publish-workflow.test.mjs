import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const prepareScript = await readFile(
  new URL("../scripts/prepare-svw-release.mjs", import.meta.url), "utf8");

test("svw release dispatch is gated, immutable, and tokenless", () => {
  assert.match(workflow, /repository_dispatch:\n\s+types: \[svw-release-published\]/);
  assert.match(workflow, /node scripts\/prepare-svw-release\.mjs/);
  assert.match(workflow, /npm run bootstrap/);
  assert.match(workflow, /npm run smoke:pi/);
  assert.match(workflow, /git tag -a/);
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN:\s*\$\{\{/);
});

test("publication happens only after import, verification, and immutable smoke", () => {
  const prepare = workflow.indexOf("node scripts/prepare-svw-release.mjs");
  const verify = workflow.indexOf("npm run verify");
  const smoke = workflow.indexOf("npm run smoke:pi");
  const commit = workflow.indexOf('git commit -m "release: track svw');
  const publish = workflow.indexOf("npm publish --access public --provenance");
  assert.ok(prepare >= 0 && prepare < verify);
  assert.ok(verify < smoke);
  assert.ok(smoke < commit);
  assert.ok(commit < publish);
  assert.match(prepareScript,
    /git", \["add", "package\.json", "package-lock\.json", "extensions\/index\.ts",\s*"skills\/svw-waveform\/SKILL\.md", "svw-source\.json"\]/);
});
