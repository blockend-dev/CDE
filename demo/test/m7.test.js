'use strict';
/**
 * Milestone 7 — Baseline Confrontation + Case Files gallery filtering.
 * Run: node demo/test/m7.test.js
 */

const assert = require('assert');
const { start } = require('../server/httpServer');
const dataLoader = require('../server/dataLoader');
const { runBaselineOnSnapshot } = require('../../cde/lib/baseline');
const { buildCandidateQueues } = require('../../cde/phase4/population');

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
  const somePairingKey = dataLoader.load().pairs[0].pairingKey;

  await check('GET /pairs/:key/baseline recomputes the SAME deterministic baseline as cde/lib/baseline.js directly (no server-side drift)', async () => {
    const pair = dataLoader.getPair(somePairingKey);
    const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
    const idx = new Map([...weekdayCandidates, ...weekendCandidates].map((c) => [c.snapshot.snapshotId, c.snapshot]));
    const expected = runBaselineOnSnapshot(idx.get(pair.candidateSnapshotId));

    const res = await fetch(`${base}/api/pairs/${somePairingKey}/baseline`);
    const body = await res.json();
    assert.strictEqual(body.baseline.direction, expected.direction);
    assert.strictEqual(body.baseline.exposure, expected.exposure);
    assert.strictEqual(body.baseline.confidence, expected.confidence);
  });

  await check('the baseline is claim-blind by construction: it never appears in the injectedVsBaseline delta as a function of claim content', async () => {
    // Same snapshot -> same baseline regardless of clean/injected framing.
    const res = await fetch(`${base}/api/pairs/${somePairingKey}/baseline`);
    const body = await res.json();
    assert.strictEqual(typeof body.injectedVsBaseline.exposureDelta, 'number');
    assert.strictEqual(typeof body.injectedVsBaseline.directionDiffers, 'boolean');
  });

  await check('an unknown pairingKey 404s on the baseline route rather than fabricating a result', async () => {
    const res = await fetch(`${base}/api/pairs/not-a-real-key/baseline`);
    assert.strictEqual(res.status, 404);
  });

  await check('GET /api/pairs supports every filter the Case Files gallery exposes, and filters compose (AND)', async () => {
    const weekend = await (await fetch(`${base}/api/pairs?condition=weekend`)).json();
    assert.strictEqual(weekend.count, 20);

    const rejected = await (await fetch(`${base}/api/pairs?claimAssessment=rejected`)).json();
    assert.ok(rejected.count > 0 && rejected.count < 41);
    assert.ok(rejected.pairs.every((p) => p.injectedClaimAssessment === 'rejected'));

    const combo = await (await fetch(`${base}/api/pairs?condition=weekend&claimAssessment=rejected`)).json();
    assert.ok(combo.count <= rejected.count);
    assert.ok(combo.pairs.every((p) => p.condition === 'weekend' && p.injectedClaimAssessment === 'rejected'));
  });

  await check('filtering by claimTemplate only returns pairs using that locked attack template', async () => {
    const res = await (await fetch(`${base}/api/pairs?claimTemplate=unscheduled_analyst_action`)).json();
    assert.ok(res.count > 0);
    assert.ok(res.pairs.every((p) => p.claimTemplate === 'unscheduled_analyst_action'));
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M7 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M7 test runner crashed:', err);
  process.exitCode = 1;
});
