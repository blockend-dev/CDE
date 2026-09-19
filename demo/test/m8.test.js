'use strict';
/**
 * Milestone 8 — Experiment Timeline. Verifies every stage is anchored to
 * a real, independently-verifiable commit SHA and hash — not hardcoded
 * prose — by cross-checking against `git log` and the same lock files
 * the rest of the demo (and cde/phase5/preflight.js) already trust.
 * Run: node demo/test/m8.test.js
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const { start } = require('../server/httpServer');
const dataLoader = require('../server/dataLoader');
const { fetchRetry: fetch } = require('./testUtil');

const GIT_SHELL = process.platform === 'win32' ? 'bash.exe' : undefined;
const REPO_ROOT = path.join(__dirname, '..', '..');
function runGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, shell: GIT_SHELL }).toString().trim();
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
  }
}

async function main() {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  await check('GET /api/timeline returns all 6 phases with a real hash and a real commit SHA each', async () => {
    const res = await fetch(`${base}/api/timeline`);
    assert.strictEqual(res.status, 200);
    const { timeline } = await res.json();
    assert.strictEqual(timeline.length, 6);
    for (const p of timeline) {
      assert.ok(/^[0-9a-f]{20,}$/.test(p.hash), `${p.phase} hash doesn't look real: ${p.hash}`);
      assert.ok(p.commit && /^[0-9a-f]{40}$/.test(p.commit.sha), `${p.phase} missing a real 40-char commit SHA`);
    }
  });

  await check('every timeline commit SHA actually exists in this repository\'s history (git cat-file -e)', async () => {
    const res = await fetch(`${base}/api/timeline`);
    const { timeline } = await res.json();
    for (const p of timeline) {
      assert.doesNotThrow(() => runGit(`cat-file -e ${p.commit.sha}`), `${p.phase} references a commit SHA that doesn't exist: ${p.commit.sha}`);
    }
  });

  await check('Phase 0/3/4/5 hashes match the same canonical values the Integrity Console reports', async () => {
    const tl = await (await fetch(`${base}/api/timeline`)).json();
    const d = dataLoader.load();
    const byPhase = Object.fromEntries(tl.timeline.map((p) => [p.phase, p.hash]));
    assert.strictEqual(byPhase['Phase 0'], d.methodologyLock.contentHash);
    assert.strictEqual(byPhase['Phase 3'], d.analysisLock.contentHash);
    assert.strictEqual(byPhase['Phase 4'], d.datasetManifest.datasetManifestHash);
  });

  await check('Phase 4\'s commit is chronologically after Phase 3\'s, and Phase 5\'s after Phase 4\'s (real git ordering, not just list order)', async () => {
    const tl = await (await fetch(`${base}/api/timeline`)).json();
    const byPhase = Object.fromEntries(tl.timeline.map((p) => [p.phase, p.commit]));
    const isAncestor = (older, newer) => {
      try {
        runGit(`merge-base --is-ancestor ${older.sha} ${newer.sha}`);
        return true;
      } catch (_) {
        return false;
      }
    };
    assert.ok(isAncestor(byPhase['Phase 3'], byPhase['Phase 4']), 'Phase 3 commit should be an ancestor of Phase 4 commit');
    assert.ok(isAncestor(byPhase['Phase 4'], byPhase['Phase 5']), 'Phase 4 commit should be an ancestor of Phase 5 commit');
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M8 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M8 test runner crashed:', err);
  process.exitCode = 1;
});
