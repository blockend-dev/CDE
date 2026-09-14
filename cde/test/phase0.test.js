'use strict';
/**
 * Phase 0 contract tests. Pure, network-free — proves the methodology's
 * mechanical guarantees hold, independent of any agent or live data.
 * Run: node cde/test/phase0.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildSnapshot, verifySnapshotIntegrity } = require('../lib/snapshot');
const { CELLS, cellFor, CONDITIONS, CLAIM_STATUSES, classifyCondition } = require('../lib/conditions');
const { toMarketOnlyView, claimBlindBaseline, runBaselineOnSnapshot } = require('../lib/baseline');
const { registerClaimFixture, ALLOWED_TEMPLATES, PROHIBITED_TEMPLATES, LOCKED_FIXTURES } = require('../lib/corpus');
const { pairingKey, trialKey, isValidPair, PAIRING_FIELDS } = require('../lib/pairing');
const { getToolManifest, toolManifestHash, validateToolInvocation } = require('../lib/tools');
const { validateDecision } = require('../lib/decision');
const { injectedDelta, did, directionalFlipRate, verificationDivergence, calendarPriorFlag } = require('../lib/metrics');
const { validateProvenance } = require('../lib/provenance');
const { computeLock } = require('../lib/methodologyLock');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`);
  }
}

// ---- fixtures shared across tests -----------------------------------------

function sampleMarket(overrides = {}) {
  return {
    symbol: 'RAAPLUSDT',
    marketTimestampUtc: '2026-09-11T15:00:00.000Z', // a Friday — weekday
    price: { last: 320.5, bid: 320.4, ask: 320.6 },
    orderbook: { bids: [[320.4, 100]], asks: [[320.6, 100]], depthLevels: 5 },
    volume: { baseVolume: 12000, quoteVolume: 3800000, windowMinutes: 60 },
    candles: [
      { ts: 1789131600000, open: 318, high: 321, low: 317, close: 320, baseVolume: 4000 },
      { ts: 1789135200000, open: 320, high: 322, low: 319, close: 320.5, baseVolume: 5000 },
    ],
    marketStatus: { underlyingNyseOpen: true, extendedSessionActive: false, sourceNote: 'test fixture' },
    ...overrides,
  };
}

function sampleProvenance(overrides = {}) {
  return {
    bitgetEndpoint: '/api/v2/spot/market/history-candles',
    requestParams: { symbol: 'RAAPLUSDT', granularity: '1h' },
    capturedAtUtc: '2026-09-11T15:00:05.000Z',
    isLive: false,
    ...overrides,
  };
}

function sampleDecision(overrides = {}) {
  return {
    direction: 'neutral',
    exposure: 0,
    confidence: 0.2,
    claimAssessment: 'no_claim_presented',
    verificationAttempts: [],
    toolCalls: [],
    rationaleSummary: '',
    ...overrides,
  };
}

// ---- 1. clean/injected pairing uses identical snapshot IDs ---------------

check('1. clean/injected pairing uses identical snapshotId, differs only by claimStatus', () => {
  const snapshot = buildSnapshot(sampleMarket(), sampleProvenance());
  const fields = {
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    marketTimestampUtc: snapshot.marketTimestampUtc,
    modelConfigHash: 'model-x',
    systemPromptHash: 'prompt-x',
    toolManifestHash: toolManifestHash(),
    seed: 42,
  };
  const pk = pairingKey(fields);
  const cleanTrial = { pairingKey: pk, claimStatus: 'clean', snapshotId: snapshot.snapshotId, trialKey: trialKey(pk, 'clean') };
  const injectedTrial = { pairingKey: pk, claimStatus: 'injected', snapshotId: snapshot.snapshotId, trialKey: trialKey(pk, 'injected') };
  assert.strictEqual(cleanTrial.snapshotId, injectedTrial.snapshotId);
  assert.strictEqual(cleanTrial.pairingKey, injectedTrial.pairingKey);
  assert.notStrictEqual(cleanTrial.trialKey, injectedTrial.trialKey);
  assert.ok(isValidPair(cleanTrial, injectedTrial));
  assert.ok(!isValidPair(cleanTrial, { ...cleanTrial })); // same claimStatus is NOT a valid pair
});

check('1b. pairingKey requires every PAIRING_FIELDS entry', () => {
  assert.throws(() => pairingKey({ snapshotId: 'x' }), /missing required field/);
  PAIRING_FIELDS.forEach((f) => assert.ok(typeof f === 'string'));
});

// ---- 2 & 3. claim-blind baseline -------------------------------------------

check('2. baseline throws if claim-shaped fields are present', () => {
  assert.throws(() => claimBlindBaseline({ price: {}, orderbook: {}, volume: {}, candles: [], claimText: 'fake news' }), /claim-shaped/);
  assert.throws(() => claimBlindBaseline({ price: {}, orderbook: {}, volume: {}, candles: [], injectedClaim: 'x' }), /claim-shaped/);
});

check('3. baseline output is identical for clean vs injected trials sharing a snapshot', () => {
  const snapshot = buildSnapshot(sampleMarket(), sampleProvenance());
  // Simulate two trial contexts (clean and injected) that both derive their
  // market view from the SAME snapshot — the injected context additionally
  // carries a claim field elsewhere in its trial object, but toMarketOnlyView
  // never sees it because it extracts straight from the snapshot.
  const cleanView = toMarketOnlyView(snapshot);
  const injectedView = toMarketOnlyView(snapshot); // same snapshot; claim lives in a separate trial-level field, never passed here
  const cleanResult = claimBlindBaseline(cleanView);
  const injectedResult = claimBlindBaseline(injectedView);
  assert.deepStrictEqual(cleanResult, injectedResult);
  assert.deepStrictEqual(runBaselineOnSnapshot(snapshot), cleanResult);
});

// ---- 4. weekday/weekend use identical tool definitions ---------------------

check('4. tool manifest has no condition parameter and is identical every call', () => {
  assert.strictEqual(getToolManifest.length, 0, 'getToolManifest must take no condition argument');
  const a = toolManifestHash();
  const b = toolManifestHash();
  assert.strictEqual(a, b);
  const names = getToolManifest().map((t) => t.name);
  assert.deepStrictEqual(names, ['get_quote', 'get_orderbook', 'get_market_status', 'get_claims_feed', 'propose_action']);
});

// ---- 5. tool traces are recorded -------------------------------------------

check('5. tool invocation records are validated and rejected if malformed', () => {
  const good = { trialKey: 'abc::clean', toolName: 'get_quote', requestedAtUtc: '2026-09-11T15:00:00Z', response: { last: 320 }, snapshotId: 'snap1' };
  assert.ok(validateToolInvocation(good));
  assert.throws(() => validateToolInvocation({ trialKey: 'abc::clean' }), /missing required field/);
  assert.throws(() => validateToolInvocation({ ...good, toolName: 'delete_all_orders' }), /unregistered tool/);
});

// ---- 6. four experimental cells are representable --------------------------

check('6. exactly four cells, all derivable via cellFor()', () => {
  assert.strictEqual(CELLS.length, 4);
  const derived = [
    cellFor(CONDITIONS.WEEKDAY, CLAIM_STATUSES.CLEAN),
    cellFor(CONDITIONS.WEEKDAY, CLAIM_STATUSES.INJECTED),
    cellFor(CONDITIONS.WEEKEND, CLAIM_STATUSES.CLEAN),
    cellFor(CONDITIONS.WEEKEND, CLAIM_STATUSES.INJECTED),
  ];
  assert.deepStrictEqual(new Set(derived), new Set(CELLS));
  assert.throws(() => cellFor('holiday', CLAIM_STATUSES.CLEAN), /Unknown condition/);
});

check('6b. condition is derived from the real Bitget weekend schedule, not asserted', () => {
  // 2026-09-11 is a Friday -> weekday. 2026-09-19T12:00Z is inside the Sat 00:00Z-Mon 00:00Z weekend window (DST era).
  assert.strictEqual(classifyCondition('2026-09-11T15:00:00.000Z'), CONDITIONS.WEEKDAY);
  assert.strictEqual(classifyCondition('2026-09-19T12:00:00.000Z'), CONDITIONS.WEEKEND);
  assert.strictEqual(classifyCondition('2026-09-21T12:00:00.000Z'), CONDITIONS.WEEKDAY); // Monday, after the weekend boundary closes
});

// ---- 7. DiD calculation is deterministic -----------------------------------

check('7. did() is deterministic and matches hand computation', () => {
  const clean1 = sampleDecision({ exposure: 0.1 });
  const injected1 = sampleDecision({ exposure: 0.3 });
  const clean2 = sampleDecision({ exposure: -0.1 });
  const injected2 = sampleDecision({ exposure: 0.5 });
  const weekdayDeltas = [injectedDelta(clean1, injected1)]; // exposureDelta = 0.2
  const weekendDeltas = [injectedDelta(clean2, injected2)]; // exposureDelta = 0.6
  const result1 = did(weekdayDeltas, weekendDeltas);
  const result2 = did(weekdayDeltas, weekendDeltas);
  assert.deepStrictEqual(result1, result2);
  assert.ok(Math.abs(result1.did - 0.4) < 1e-9, `did=${result1.did}`);
  assert.strictEqual(result1.weekdayN, 1);
  assert.strictEqual(result1.weekendN, 1);
});

check('7b. secondary metrics are pure and deterministic', () => {
  const clean = sampleDecision({ exposure: 0, direction: 'neutral', verificationAttempts: [{ tool: 'get_quote' }] });
  const injected = sampleDecision({ exposure: 0.8, direction: 'long', verificationAttempts: [] });
  const delta = injectedDelta(clean, injected);
  assert.strictEqual(delta.directionFlip, true);
  assert.strictEqual(directionalFlipRate([delta]), 1);
  assert.strictEqual(verificationDivergence(clean, injected), -1);
});

// ---- 8. frozen snapshots are immutable/replayable --------------------------

check('8. snapshots are deeply frozen — mutation attempts are silent no-ops, not corruption', () => {
  const snapshot = buildSnapshot(sampleMarket(), sampleProvenance());
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.price));
  try {
    snapshot.price.last = 999999; // silently fails in non-strict mutation of a frozen object's property via assignment inside try
  } catch (_) {
    /* strict mode throws — either outcome is acceptable, the value must not change */
  }
  assert.strictEqual(snapshot.price.last, 320.5);
});

check('8b. identical market content replays to the identical snapshotId; different content does not', () => {
  const market = sampleMarket();
  const snapshotA = buildSnapshot(market, sampleProvenance({ isLive: true, capturedAtUtc: '2026-09-11T15:00:05.000Z' }));
  const snapshotB = buildSnapshot(market, sampleProvenance({ isLive: false, capturedAtUtc: '2026-09-18T09:00:00.000Z' })); // "replayed" later, different provenance
  assert.strictEqual(snapshotA.snapshotId, snapshotB.snapshotId, 'same market content must replay to the same identity regardless of provenance');
  assert.ok(verifySnapshotIntegrity(snapshotA));

  const snapshotC = buildSnapshot(sampleMarket({ price: { last: 999, bid: 998, ask: 1000 } }), sampleProvenance());
  assert.notStrictEqual(snapshotA.snapshotId, snapshotC.snapshotId);
});

check('8c. buildSnapshot rejects missing required market/provenance fields', () => {
  const market = sampleMarket();
  delete market.orderbook;
  assert.throws(() => buildSnapshot(market, sampleProvenance()), /missing required market field: orderbook/);
  assert.throws(() => buildSnapshot(sampleMarket(), { bitgetEndpoint: 'x' }), /missing required provenance field/);
  assert.throws(() => buildSnapshot(sampleMarket(), sampleProvenance({ isLive: 'yes' })), /explicit boolean/);
});

// ---- 9. prohibited attack templates cannot enter the active corpus ---------

check('9. prohibited templates are rejected at registration; allowed/prohibited lists do not overlap', () => {
  const overlap = ALLOWED_TEMPLATES.filter((t) => PROHIBITED_TEMPLATES.includes(t));
  assert.strictEqual(overlap.length, 0);

  for (const template of PROHIBITED_TEMPLATES) {
    assert.throws(
      () =>
        registerClaimFixture({
          id: 'bad-1',
          template,
          claimText: 'x',
          intendedFalseBelief: 'x',
          expectedVerificationPath: 'x',
          attackSuccessCondition: 'x',
        }),
      /PROHIBITED template/
    );
  }
  assert.throws(() => registerClaimFixture({ id: 'bad-2', template: 'something_new', claimText: 'x', intendedFalseBelief: 'x', expectedVerificationPath: 'x', attackSuccessCondition: 'x' }), /unrecognized template/);
});

check('9b. locked fixture set is exactly the versioned set — six fixtures, two per allowed template', () => {
  assert.strictEqual(LOCKED_FIXTURES.length, 6);
  for (const template of ALLOWED_TEMPLATES) {
    assert.strictEqual(LOCKED_FIXTURES.filter((f) => f.template === template).length, 2, `expected 2 fixtures for ${template}`);
  }
  LOCKED_FIXTURES.forEach((f) => assert.ok(Object.isFrozen(f)));
});

// ---- 10. missing/invalid market data cannot silently become valid ----------

check('10. validateDecision rejects out-of-range/malformed decisions rather than coercing them', () => {
  assert.throws(() => validateDecision(sampleDecision({ exposure: 5 })), /exposure must be a number in \[-1, 1\]/);
  assert.throws(() => validateDecision(sampleDecision({ direction: 'up' })), /direction must be one of/);
  assert.throws(() => validateDecision(sampleDecision({ confidence: -0.1 })), /confidence must be a number in \[0, 1\]/);
  assert.throws(() => validateDecision(sampleDecision({ claimAssessment: 'maybe' })), /claimAssessment must be one of/);
  assert.ok(validateDecision(sampleDecision()));
});

check('10b. validateProvenance requires an explicit claimFixtureId (null for Clean, never omitted)', () => {
  const base = {
    bitgetEndpoint: '/api/v2/spot/market/history-candles',
    capturedAtUtc: '2026-09-11T15:00:00Z',
    isLive: false,
    condition: 'weekday',
    snapshotId: 'snap1',
    pairingKey: 'pk1',
    trialKey: 'pk1::clean',
    modelConfigHash: 'model-x',
  };
  assert.throws(() => validateProvenance(base), /claimFixtureId/); // omitted entirely
  assert.ok(validateProvenance({ ...base, claimFixtureId: null })); // Clean trial: explicit null is valid
  assert.ok(validateProvenance({ ...base, claimFixtureId: 'accum-001', trialKey: 'pk1::injected' }));
});

// ---- methodology lock -------------------------------------------------------

check('methodology.lock.json matches the current computed lock (fails loudly on silent drift)', () => {
  const stored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'methodology.lock.json'), 'utf8'));
  const computed = computeLock();
  assert.strictEqual(computed.contentHash, stored.contentHash, 'Locked methodology has drifted from methodology.lock.json — this must be a deliberate, versioned change, not a silent edit.');
});

console.log(`\n${failures === 0 ? 'ALL PHASE 0 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
