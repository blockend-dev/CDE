'use strict';
/**
 * Milestone 9 — Judge Mode. This is a scripted DOM-driving walkthrough
 * with no framework and no jsdom dependency added, so a real browser
 * click-through can't be simulated headlessly here (same limitation
 * accepted for M1/M2's rendering code, verified there by `node --check`
 * + data-layer tests). These tests instead verify: (a) the real data the
 * script's pair-selection step depends on, (b) that every DOM selector
 * judgeMode.js hardcodes actually has a matching target in the screen it
 * drives — a mechanical drift guard, not a full render test — and (c)
 * that its exports are well-formed.
 * Run: node demo/test/m9.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start } = require('../server/httpServer');
const { fetchRetry: fetch } = require('./testUtil');

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

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', 'web', rel), 'utf8');
}

async function main() {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  await check('the pair-selection query Judge Mode uses (changed=true) returns a real, non-empty, genuinely-changed candidate set', async () => {
    const res = await fetch(`${base}/api/pairs?changed=true`);
    const body = await res.json();
    assert.ok(body.count > 0, 'Judge Mode would silently fall back to an arbitrary pair — the interesting-pair filter should not be empty');
    assert.ok(body.pairs.every((p) => p.structuredDecisionChanged), 'every pair returned by changed=true must actually have a structured decision change');
  });

  await check('the tamper scenario Judge Mode drives ("modify-trial") still exists in the real scenario list', async () => {
    const res = await fetch(`${base}/api/tamper/scenarios`);
    const body = await res.json();
    assert.ok(body.scenarios.some((s) => s.key === 'modify-trial'), 'judgeMode.js hardcodes data-scenario-key="modify-trial" — this must stay in sync with tamper.js');
  });

  await check('break.js actually renders a button with data-scenario-key="modify-trial" for judgeMode.js to click', () => {
    const source = read('screens/break.js');
    assert.ok(/data-scenario-key['"]?\s*:\s*s\.key/.test(source), 'break.js must stamp data-scenario-key on its attack buttons for Judge Mode to target them');
  });

  await check('integrity.js actually renders a button whose text is exactly "VERIFY EXPERIMENT" for judgeMode.js to click', () => {
    const source = read('screens/integrity.js');
    assert.ok(source.includes('VERIFY EXPERIMENT'), 'judgeMode.js searches button text for "VERIFY EXPERIMENT" — integrity.js must keep this exact label');
  });

  await check('judgeMode.js exports startJudgeMode and stopJudgeMode, and lab.js wires the START button to it', () => {
    const jm = read('judgeMode.js');
    assert.ok(/export (async )?function startJudgeMode/.test(jm));
    assert.ok(/export function stopJudgeMode/.test(jm));
    const lab = read('screens/lab.js');
    assert.ok(lab.includes('startJudgeMode'), 'lab.js must import and call startJudgeMode from its START button');
  });

  await check('every hash the script navigates to is a route main.js actually recognizes', () => {
    const jm = read('judgeMode.js');
    const hashes = [...jm.matchAll(/hash:\s*[`'"]([^`'"]*)[`'"]?/g)].map((m) => m[1]);
    const staticHashes = hashes.filter((h) => !h.includes('${'));
    for (const h of staticHashes) assert.ok(['#/lab', '#/integrity', '#/break'].includes(h), `unexpected static hash in judgeMode.js: ${h}`);
    const dynamicHashes = hashes.filter((h) => h.includes('${'));
    assert.ok(dynamicHashes.every((h) => h.startsWith('#/pair/')), 'every dynamic hash must be a #/pair/... route, which pairDetail.js handles');
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M9 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M9 test runner crashed:', err);
  process.exitCode = 1;
});
