'use strict';
/**
 * SINGLE REAL-MODEL SMOKE TEST — NOT A RESEARCH RUN.
 *
 * Proves the pipe works end to end:
 *   fixture snapshot -> real model -> fixture-backed tools -> structured
 *   decision -> trace -> serialized result
 *
 * Scope: exactly one pair (Clean + Injected) against ONE synthetic fixture
 * snapshot. This is deliberately far short of the four-cell design and
 * must never be read as a research result — see the explicit
 * `artifactType` marker in the written output and cde/phase2/README.md.
 *
 * Uses NO live Bitget data, NO Bitget Demo/paper trading, NO live trading.
 * Requires a real ANTHROPIC_API_KEY in the environment; if absent or
 * invalid, this fails with a typed authentication_or_configuration
 * failure — which is itself a correct, informative outcome for a smoke
 * test to report, not something to paper over.
 */

const fs = require('fs');
const path = require('path');

const { WEEKDAY_SNAPSHOT } = require('../phase1/fixtures/syntheticSnapshots');
const { loadFixtureSnapshot } = require('../phase1/fixtureLoader');
const { AnthropicProviderClient } = require('./provider/anthropicClient');
const { createRealModelAdapter } = require('./realModelAdapter');
const { runOnePair } = require('./runRealModelExperiment');
const { apiKey, MODEL, TEMPERATURE, MAX_TOKENS, RETRY_POLICY } = require('./config');
const { redactSecrets, containsNoSecrets } = require('./secretRedaction');
const { serializeResult } = require('../phase1/resultSerializer');

const SMOKE_TEST_CLAIM_FIXTURE_ID = 'accum-001';

async function runSmokeTest() {
  const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
  const providerClient = new AnthropicProviderClient({
    apiKey: apiKey(),
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    retryPolicy: RETRY_POLICY,
  });

  const outcome = await runOnePair({
    snapshot,
    claimFixtureId: SMOKE_TEST_CLAIM_FIXTURE_ID,
    providerClient,
    adapterFactory: createRealModelAdapter,
  });

  const artifact = {
    artifactType: 'MODEL_SMOKE_TEST_NOT_RESEARCH_EVIDENCE',
    note: 'Single pair, single fixture snapshot. Proves the real-model adapter runs inside the Phase 1 harness. Not a research-scale run and not evidence for the CDE hypothesis.',
    generatedAt: new Date().toISOString(), // wall-clock is fine here — this artifact makes no determinism claim
    model: MODEL,
    outcome,
  };

  return redactSecrets(artifact);
}

if (require.main === module) {
  (async () => {
    const artifact = await runSmokeTest();
    if (!containsNoSecrets(artifact)) {
      // Defense in depth: refuse to write anything if redaction somehow missed something.
      console.error('REFUSING TO WRITE SMOKE TEST OUTPUT: possible secret detected after redaction.');
      process.exit(3);
    }

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'smoke_test_result.json');
    fs.writeFileSync(outPath, serializeResult(artifact));

    console.log('=== PHASE 2 MODEL SMOKE TEST (not research evidence) ===');
    console.log('status:', artifact.outcome.status);
    if (artifact.outcome.status === 'failed') {
      console.log('failureCategory:', artifact.outcome.failureCategory);
      console.log('message:', artifact.outcome.message);
    } else {
      console.log('condition:', artifact.outcome.condition);
      console.log('clean decision:', JSON.stringify(artifact.outcome.pair.clean.decision.direction), artifact.outcome.pair.clean.decision.exposure);
      console.log('injected decision:', JSON.stringify(artifact.outcome.pair.injected.decision.direction), artifact.outcome.pair.injected.decision.exposure);
    }
    console.log('written to:', outPath);
    process.exit(artifact.outcome.status === 'completed' ? 0 : 2);
  })().catch((err) => {
    console.error('Smoke test runner crashed unexpectedly:', redactSecrets(String(err && err.stack)));
    process.exit(1);
  });
}

module.exports = { runSmokeTest, SMOKE_TEST_CLAIM_FIXTURE_ID };
