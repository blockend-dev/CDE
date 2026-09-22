'use strict';
/**
 * Milestone 1 — demo shell + data adapter. Boots the server on an
 * ephemeral port inside this process (no stray background listeners),
 * exercises the API against the real frozen dataset, and closes the
 * server before exiting. Run: node demo/test/m1.test.js
 */

const assert = require('assert');
const { start } = require('../server/httpServer');

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

  await check('GET /api/experiment reports the exact frozen sample and primary result', async () => {
    const res = await fetch(`${base}/api/experiment`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.completedPairs, 41);
    assert.deepStrictEqual(body.completedByCondition, { weekday: 21, weekend: 20 });
    assert.strictEqual(body.primary.pointEstimate.did, -0.0025);
    assert.strictEqual(body.hashes.methodologyLockHash, '5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54');
  });

  await check('GET /api/pairs lists all 41 completed pairs with UI-safe fields only', async () => {
    const res = await fetch(`${base}/api/pairs`);
    const body = await res.json();
    assert.strictEqual(body.count, 41);
    assert.ok(body.pairs.every((p) => !('clean' in p) && !('injected' in p)), 'list view must not leak full trial payloads');
  });

  await check('GET /api/pairs?condition=weekend filters correctly', async () => {
    const res = await fetch(`${base}/api/pairs?condition=weekend`);
    const body = await res.json();
    assert.strictEqual(body.count, 20);
    assert.ok(body.pairs.every((p) => p.condition === 'weekend'));
  });

  await check('GET /api/pairs/:pairingKey returns one full pair with claim text resolved from the locked corpus', async () => {
    const list = await (await fetch(`${base}/api/pairs`)).json();
    const key = list.pairs[0].pairingKey;
    const res = await fetch(`${base}/api/pairs/${key}`);
    const pair = await res.json();
    assert.strictEqual(pair.pairingKey, key);
    assert.ok(pair.claimText && pair.claimText.length > 0);
    assert.ok(pair.clean.decision && pair.injected.decision);
  });

  await check('GET /api/pairs/:pairingKey 404s cleanly for an unknown key', async () => {
    const res = await fetch(`${base}/api/pairs/does-not-exist`);
    assert.strictEqual(res.status, 404);
  });

  await check('GET / serves the SPA shell', async () => {
    const res = await fetch(`${base}/`);
    assert.strictEqual(res.status, 200);
    assert.ok((await res.text()).includes('<div id="app">'));
  });

  await check('GET /css/main.css and /js/main.js serve with correct content types', async () => {
    const css = await fetch(`${base}/css/main.css`);
    const js = await fetch(`${base}/js/main.js`);
    assert.ok(css.headers.get('content-type').includes('text/css'));
    assert.ok(js.headers.get('content-type').includes('javascript'));
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${failures === 0 ? 'ALL DEMO M1 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M1 test runner crashed:', err);
  process.exit(1);
});
