'use strict';
/**
 * `npm test`: every suite in the repository, in order — the frozen research
 * phases, the precondition study, and the demo (M1-M13). Exit code is
 * non-zero if any suite fails.
 *
 * Some research suites (cde/test/phase5.test.js) legitimately re-run the
 * locked analysis and rewrite its committed result with a fresh timestamp.
 * The frozen artifacts must not be left modified by a test run, so this
 * runner snapshots the exact bytes of everything under cde/ and research/
 * first and restores any file a suite changed (reporting it), and reports
 * any file a suite left behind.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const FROZEN_DIRS = ['cde', 'research'];

const SUITES = [
  'cde/test/phase0.test.js',
  'cde/test/phase1.test.js',
  'cde/test/phase2.test.js',
  'cde/test/phase3.test.js',
  'cde/test/phase4.test.js',
  'cde/test/phase5.test.js',
  'research/weekend-informativeness/selfTest.js',
  ...Array.from({ length: 11 }, (_, i) => `demo/test/m${i + 1}.test.js`),
  'demo/test/m12.test.js',
  'demo/test/m13.browser.test.js',
];

function snapshot() {
  const files = new Map();
  for (const d of FROZEN_DIRS) {
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs);
        else files.set(abs, fs.readFileSync(abs));
      }
    })(path.join(REPO, d));
  }
  return files;
}

const before = snapshot();
const restored = new Set();
const extras = new Set();

// Restore after EVERY suite, not just at the end: a later suite (the demo's integrity checks compare
// against the committed analysis result) must never see an artifact an earlier suite rewrote.
function restoreFrozen() {
  const now = snapshot();
  for (const [file, bytes] of before) {
    if (!now.has(file) || !now.get(file).equals(bytes)) {
      fs.writeFileSync(file, bytes);
      restored.add(path.relative(REPO, file));
    }
  }
  for (const file of now.keys()) if (!before.has(file)) extras.add(path.relative(REPO, file));
}

const results = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync(process.execPath, [path.join(REPO, suite)], { stdio: 'inherit', cwd: REPO });
  results.push({ suite, ok: r.status === 0 });
  restoreFrozen();
}

console.log('\n=== summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.suite}`);
if (restored.size) console.log(`\nrestored ${restored.size} frozen file(s) that a suite rewrote (e.g. a re-run analysis): ${[...restored].join(', ')}`);
if (extras.size) console.log(`\nWARNING: suites left new files under the frozen directories: ${[...extras].join(', ')}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL SUITES PASSED' : `${failed.length} SUITE(S) FAILED`}`);
process.exitCode = failed.length === 0 && extras.size === 0 ? 0 : 1;
