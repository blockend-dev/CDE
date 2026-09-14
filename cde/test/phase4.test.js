'use strict';
/**
 * Phase 4 tests. This file grows across the phase's milestones. No real
 * model calls are made by any test here — population/snapshot/manifest
 * logic is pure and tested without network access.
 * Run: node cde/test/phase4.test.js
 */

const assert = require('assert');

const { validRecords, buildCandidateQueues } = require('../phase4/population');
const { buildReplaySnapshot, REPLAY_ENDPOINT_MARKER } = require('../phase4/replaySnapshot');
const { buildRunManifest } = require('../phase4/runManifest');
const { classifyCondition } = require('../lib/conditions');
const { loadFixtureSnapshot } = require('../phase1/fixtureLoader');
const integrity = require('../phase1/integrity');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

console.log('== population.js ==');

check('validRecords() reuses the precondition study\'s own validity definition (887 valid records, matching its published result)', () => {
  const records = validRecords();
  assert.strictEqual(records.length, 887, `expected the precondition study's documented 887 valid observations, got ${records.length}`);
});

check('buildCandidateQueues() produces deterministic, symbol-then-date-sorted queues, not outcome-ordered', () => {
  const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
  assert.ok(weekdayCandidates.length > 100 && weekendCandidates.length > 100);
  for (let i = 1; i < Math.min(50, weekdayCandidates.length); i++) {
    const a = weekdayCandidates[i - 1].record;
    const b = weekdayCandidates[i].record;
    const ordered = a.symbol < b.symbol || (a.symbol === b.symbol && a.saturdayIso <= b.saturdayIso);
    assert.ok(ordered, `candidates ${i - 1}/${i} are not in the declared deterministic sort order`);
  }
});

check('buildCandidateQueues() is deterministic across repeated calls (same order, same snapshot IDs)', () => {
  const a = buildCandidateQueues();
  const b = buildCandidateQueues();
  assert.strictEqual(a.weekdayCandidates.length, b.weekdayCandidates.length);
  assert.deepStrictEqual(
    a.weekdayCandidates.slice(0, 20).map((c) => c.snapshot.snapshotId),
    b.weekdayCandidates.slice(0, 20).map((c) => c.snapshot.snapshotId)
  );
});

check('every candidate\'s condition is derived from its real timestamp via the existing classifier, never asserted', () => {
  const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
  for (const c of weekdayCandidates.slice(0, 30)) {
    assert.strictEqual(classifyCondition(c.snapshot.marketTimestampUtc), 'weekday');
    assert.strictEqual(c.snapshot.condition, 'weekday');
  }
  for (const c of weekendCandidates.slice(0, 30)) {
    assert.strictEqual(classifyCondition(c.snapshot.marketTimestampUtc), 'weekend');
    assert.strictEqual(c.snapshot.condition, 'weekend');
  }
});

console.log('== replaySnapshot.js — honesty boundary ==');

check('price.last, symbol, and marketTimestampUtc are the REAL values from the precondition record', () => {
  const records = validRecords();
  const record = records[0];
  const snap = buildReplaySnapshot(record, 'weekday');
  assert.strictEqual(snap.symbol, record.symbol);
  assert.strictEqual(snap.price.last, record.observation.fridayRef);
  assert.strictEqual(new Date(snap.marketTimestampUtc).getTime(), record.observation.fridayCandleTs);
});

check('orderbook/volume/candles are clearly-labeled derived placeholders, never claimed as independently real', () => {
  const records = validRecords();
  const snap = buildReplaySnapshot(records[0], 'weekend');
  assert.strictEqual(snap.volume.baseVolume, 0);
  assert.strictEqual(snap.candles.length, 1);
  assert.strictEqual(snap.candles[0].close, snap.price.last);
  assert.ok(/derived/i.test(snap.marketStatus.sourceNote));
  assert.ok(/DERIVED/.test(snap.provenance.disclosure) && /REAL/.test(snap.provenance.disclosure));
});

check('provenance carries the REPLAY: marker, isLive: false, and is accepted by the fixture-loader-equivalent integrity check', () => {
  const records = validRecords();
  const snap = buildReplaySnapshot(records[0], 'weekday');
  assert.ok(snap.provenance.bitgetEndpoint.startsWith('REPLAY:'));
  assert.strictEqual(snap.provenance.bitgetEndpoint, REPLAY_ENDPOINT_MARKER);
  assert.strictEqual(snap.provenance.isLive, false);
  assert.doesNotThrow(() => integrity.assertNotResearchStudyOutput(snap), 'a REPLAY: snapshot must be accepted alongside FIXTURE: snapshots');
});

check('buildReplaySnapshot refuses to fabricate when the real field is missing, rather than inventing a value', () => {
  const fakeRecord = { symbol: 'RTESTUSDT', saturdayIso: '2026-01-03', observation: { fridayRef: null, fridayCandleTs: null, weekendEndPrice: 100, weekendEndCandleTs: 1234567890000 } };
  assert.throws(() => buildReplaySnapshot(fakeRecord, 'weekday'), /refusing to fabricate/);
  assert.doesNotThrow(() => buildReplaySnapshot(fakeRecord, 'weekend'));
});

check('Phase 1 FIXTURE: snapshots are unaffected by the REPLAY: acceptance change (regression check)', () => {
  const { WEEKDAY_SNAPSHOT } = require('../phase1/fixtures/syntheticSnapshots');
  assert.doesNotThrow(() => loadFixtureSnapshot(WEEKDAY_SNAPSHOT));
});

console.log('== runManifest.js ==');

check('buildRunManifest() captures every required field and is content-addressed', () => {
  const manifest = buildRunManifest();
  const required = [
    'runId',
    'startedAtUtc',
    'methodologyLockHash',
    'analysisLockHash',
    'provider',
    'model',
    'modelConfigHash',
    'promptVersion',
    'promptHash',
    'toolManifestHash',
    'attackCorpusHash',
    'adapterVersion',
    'experimentVersion',
    'analysisSeed',
    'targetMinCompletedPairsPerCondition',
    'maxAttemptedPairs',
    'repositoryCommitSha',
    'manifestHash',
  ];
  required.forEach((f) => assert.ok(f in manifest, `manifest missing required field: ${f}`));
  assert.strictEqual(manifest.methodologyLockHash, '5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54');
  assert.strictEqual(manifest.analysisLockHash, '43e0479499d286f4dfe06fd8ec4a036941cd3df1ff0b8afeaee423e2e167fdd7');
});

check('the manifest never contains the API key or anything secret-shaped', () => {
  const { containsNoSecrets } = require('../phase2/secretRedaction');
  const manifest = buildRunManifest();
  assert.ok(containsNoSecrets(manifest));
  assert.ok(!('apiKey' in manifest) && !JSON.stringify(manifest).toLowerCase().includes('api_key'));
});

console.log(`\n${failures === 0 ? 'ALL PHASE 4 (MILESTONE 1) TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
