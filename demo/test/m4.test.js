'use strict';
/**
 * Milestone 4 — Integrity Console. Exercises the real API routes (not a
 * mock): /api/integrity/identity and the live /api/integrity/verify,
 * which genuinely re-runs cde/phase5/preflight.js and re-executes the
 * locked analysis. Takes several seconds by design — it is real
 * computation, not a staged delay.
 * Run: node demo/test/m4.test.js
 */

const assert = require('assert');
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

async function main() {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  await check('GET /api/integrity/identity returns 8 hash-identified components, all real hashes', async () => {
    const res = await fetch(`${base}/api/integrity/identity`);
    const body = await res.json();
    assert.strictEqual(body.identity.length, 8);
    for (const row of body.identity) {
      assert.ok(/^[0-9a-f]{20,}$/.test(row.hash), `${row.label} hash doesn't look like a real content hash: ${row.hash}`);
    }
    const methodology = body.identity.find((r) => r.label === 'Methodology lock');
    assert.strictEqual(methodology.hash, '5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54');
  });

  await check('POST /api/integrity/verify actually re-executes preflight + analysis and reports every check passing on the untouched canonical dataset', async () => {
    const res = await fetch(`${base}/api/integrity/verify`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.allPassed, true, JSON.stringify(body.checks.filter((c) => !c.pass)));
    assert.strictEqual(body.checks.length, 14, 'expected 13 preflight checks + 1 live reproducibility check');
    const repro = body.checks.find((c) => c.name === 'reproducibility');
    assert.ok(repro, 'reproducibility check missing');
    assert.strictEqual(repro.detail.committedHash, repro.detail.freshHash, 're-running the locked analysis right now must reproduce the exact committed hash');
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M4 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M4 test runner crashed:', err);
  process.exitCode = 1;
});
