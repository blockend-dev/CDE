'use strict';
/**
 * Milestone 6 — Provenance Explorer. Verifies field-level classification
 * is regenerated from the real frozen population/replay logic (not
 * hardcoded), and that REAL/DERIVED/FIXTURE labeling is honest and
 * consistent with cde/phase4/replaySnapshot.js's own documented boundary.
 * Run: node demo/test/m6.test.js
 */

const assert = require('assert');
const { start } = require('../server/httpServer');
const dataLoader = require('../server/dataLoader');

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

  await check('GET /pairs/:key/provenance classifies exactly the real/derived split cde/phase4/replaySnapshot.js documents', async () => {
    const res = await fetch(`${base}/api/pairs/${somePairingKey}/provenance`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const byPath = Object.fromEntries(body.snapshot.fields.map((f) => [f.path, f.classification]));
    assert.strictEqual(byPath['symbol'], 'REAL');
    assert.strictEqual(byPath['marketTimestampUtc'], 'REAL');
    assert.strictEqual(byPath['price.last'], 'REAL');
    assert.strictEqual(byPath['orderbook'], 'DERIVED');
    assert.strictEqual(byPath['volume'], 'DERIVED');
    assert.strictEqual(byPath['candles'], 'DERIVED');
  });

  await check('the REAL fields in the provenance response match the same pair\'s actual recorded symbol/timestamp (no drift between views)', async () => {
    const pairRes = await fetch(`${base}/api/pairs/${somePairingKey}`);
    const pair = await pairRes.json();
    const provRes = await fetch(`${base}/api/pairs/${somePairingKey}/provenance`);
    const prov = await provRes.json();
    const symbolField = prov.snapshot.fields.find((f) => f.path === 'symbol');
    const tsField = prov.snapshot.fields.find((f) => f.path === 'marketTimestampUtc');
    assert.strictEqual(symbolField.value, pair.symbol);
    assert.strictEqual(tsField.value, pair.marketTimestampUtc);
  });

  await check('the snapshot provenance marker starts with REPLAY: and isLive is false, for every one of the 41 pairs', async () => {
    for (const p of dataLoader.load().pairs) {
      const res = await fetch(`${base}/api/pairs/${p.pairingKey}/provenance`);
      const body = await res.json();
      assert.ok(body.snapshot.provenanceMarker.startsWith('REPLAY:'), `${p.pairingKey} provenance marker is not REPLAY:`);
      assert.strictEqual(body.snapshot.isLive, false, `${p.pairingKey} isLive must be false`);
    }
  });

  await check('the claim is classified FIXTURE, and its text matches the locked corpus verbatim (interpolated only with the real symbol)', async () => {
    const res = await fetch(`${base}/api/pairs/${somePairingKey}/provenance`);
    const body = await res.json();
    assert.strictEqual(body.claim.classification, 'FIXTURE');
    assert.ok(body.claim.text.length > 10);
  });

  await check('an unknown pairingKey 404s cleanly rather than fabricating provenance', async () => {
    const res = await fetch(`${base}/api/pairs/not-a-real-key/provenance`);
    assert.strictEqual(res.status, 404);
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M6 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M6 test runner crashed:', err);
  process.exitCode = 1;
});
