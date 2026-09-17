'use strict';
/**
 * Milestone 3 — Truth -> Belief -> Action chain + Evidence X-Ray. Verifies
 * the data the chain/x-ray tabs render, in particular the real
 * corroboration-availability signal (underlyingNyseOpen) that
 * distinguishes the weekday and weekend conditions, and that the X-Ray
 * never has anything beyond the typed decision schema to draw on.
 * Run: node demo/test/m3.test.js
 */

const assert = require('assert');
const dataLoader = require('../server/dataLoader');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
  }
}

const { pairs } = dataLoader.load();

function toolResponse(decision, name) {
  const call = decision.toolCalls.find((tc) => tc.toolName === name);
  return call ? call.response : null;
}

check('the CORROBORATION node\'s underlyingNyseOpen signal matches the pair condition on every pair (this is the actual corroboration-degradation mechanism)', () => {
  for (const p of pairs) {
    const status = toolResponse(p.injected.decision, 'get_market_status');
    assert.ok(status, `${p.pairingKey} missing get_market_status response`);
    if (p.condition === 'weekday') assert.strictEqual(status.underlyingNyseOpen, true, `${p.pairingKey} weekday should show NYSE open`);
    if (p.condition === 'weekend') assert.strictEqual(status.underlyingNyseOpen, false, `${p.pairingKey} weekend should show NYSE closed`);
  }
});

check('the CLAIM node text always matches the CORROBORATION node\'s claims-feed item text for the same pair', () => {
  for (const p of pairs) {
    const feed = toolResponse(p.injected.decision, 'get_claims_feed');
    const item = feed.items.find((it) => it.id === p.claimFixtureId);
    assert.ok(item, `${p.pairingKey} claims-feed item missing for its own claimFixtureId`);
    assert.strictEqual(item.text, p.claimText, `${p.pairingKey} claims-feed item text must match the resolved claim text shown in the CLAIM node`);
  }
});

check('the X-Ray has nothing to draw on beyond the typed decision fields (no free-form reasoning field exists to accidentally expose)', () => {
  const ALLOWED_TOP_LEVEL = new Set(['direction', 'exposure', 'confidence', 'claimAssessment', 'verificationAttempts', 'toolCalls', 'rationaleSummary', 'modelAudit']);
  for (const p of pairs) {
    for (const member of [p.clean, p.injected]) {
      for (const key of Object.keys(member.decision)) {
        assert.ok(ALLOWED_TOP_LEVEL.has(key), `${p.pairingKey} decision has an unexpected field "${key}" the X-Ray doesn't account for`);
      }
    }
  }
});

check('every verification attempt names a real tool from the locked tool manifest', () => {
  const { TOOL_MANIFEST } = require('../../cde/lib/tools');
  const names = new Set(TOOL_MANIFEST.map((t) => t.name));
  for (const p of pairs) {
    for (const member of [p.clean, p.injected]) {
      for (const v of member.decision.verificationAttempts) {
        assert.ok(names.has(v.tool), `${p.pairingKey} verification attempt references unknown tool "${v.tool}"`);
      }
    }
  }
});

console.log(`\n${failures === 0 ? 'ALL DEMO M3 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
