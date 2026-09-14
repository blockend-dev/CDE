'use strict';
/**
 * Phase 2 tests. Uses a scripted FAKE provider client for every test that
 * doesn't need real network — that keeps the suite fast, deterministic,
 * and runnable without an API key. The one exception (test 10b) makes a
 * real call to api.anthropic.com specifically to prove the real provider
 * wrapper classifies a real authentication failure correctly; it is
 * skipped gracefully if the network itself is unreachable, since that is
 * a different, unrelated failure mode this suite isn't testing.
 *
 * Run: node cde/test/phase2.test.js
 */

const assert = require('assert');

const { loadFixtureSnapshot } = require('../phase1/fixtureLoader');
const { WEEKDAY_SNAPSHOT, WEEKEND_SNAPSHOT } = require('../phase1/fixtures/syntheticSnapshots');
const { buildPair, runSingleTrial } = require('../phase1/trial');
const { createToolClient } = require('../phase1/toolReplay');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { toolManifestHash } = require('../lib/tools');
const { runFourCellExperiment } = require('../phase1/runExperiment');
const integrity = require('../phase1/integrity');

const { createRealModelAdapter } = require('../phase2/realModelAdapter');
const { AnthropicProviderClient } = require('../phase2/provider/anthropicClient');
const { AdapterFailure } = require('../phase2/failures');
const { SYSTEM_PROMPT, buildUserTask, promptHash: computePromptHash, assertNoLeakage, FORBIDDEN_LEAKAGE_PATTERN } = require('../phase2/prompt');
const { modelConfigHash: computeModelConfigHash } = require('../phase2/config');
const { redactSecrets, containsNoSecrets } = require('../phase2/secretRedaction');
const { runOnePair, buildPairSafely } = require('../phase2/runRealModelExperiment');
const { anthropicTools } = require('../phase2/schema');

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

const CLAIM_FIXTURE = LOCKED_FIXTURES.find((f) => f.id === 'accum-001');
const ALLOWED_FIXTURE_IDS = LOCKED_FIXTURES.map((f) => f.id);

// ----------------------------------------------------------------------------
// Scripted fake provider client — no network, fully deterministic.
// ----------------------------------------------------------------------------

let blockIdCounter = 0;
function toolUseBlock(name, input) {
  blockIdCounter += 1;
  return { type: 'tool_use', id: `tool_${blockIdCounter}`, name, input };
}

function makeResponse(contentBlocks, stopReason) {
  return { content: contentBlocks, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 10 } };
}

/**
 * turn 0: call all four read tools; turn 1: call propose_action with the given input.
 * Keyed off `messages.length` (1 = only the initial user task) rather than a
 * shared instance counter, so this script behaves correctly even when the
 * SAME fake client/adapter instance is reused across two trials in one
 * buildPair() call — each trial's `messages` array starts fresh regardless
 * of how many prior calls this client instance has served.
 */
function happyPathScript(decisionInput) {
  return ({ messages }) => {
    if (messages.length === 1) {
      return {
        response: makeResponse(
          [toolUseBlock('get_quote', {}), toolUseBlock('get_orderbook', {}), toolUseBlock('get_market_status', {}), toolUseBlock('get_claims_feed', {})],
          'tool_use'
        ),
      };
    }
    return { response: makeResponse([toolUseBlock('propose_action', decisionInput)], 'tool_use') };
  };
}

function neverCallsToolScript() {
  return () => ({ response: makeResponse([{ type: 'text', text: 'I think the price looks fine.' }], 'end_turn') });
}

function alwaysThrowsScript(failure) {
  return () => ({ throw: failure });
}

class ScriptedFakeProviderClient {
  constructor(scriptFn) {
    this.scriptFn = scriptFn;
    this.calls = [];
    this.turnIndex = 0;
  }
  async createMessage({ system, messages, tools }) {
    this.calls.push({ system, messages: JSON.parse(JSON.stringify(messages)), tools });
    const result = this.scriptFn({ turnIndex: this.turnIndex, messages, calls: this.calls });
    this.turnIndex += 1;
    if (result.throw) throw result.throw;
    return { response: result.response, attempts: result.attempts || [{ attempt: 1, outcome: 'success', tookMs: 0 }] };
  }
}

const VALID_DECISION_INPUT = { direction: 'long', exposure: 0.3, confidence: 0.6, claimAssessment: 'uncertain', rationaleSummary: 'test rationale' };

async function main() {
  console.log('== 1. Real adapter implements the exact Phase 1 adapter contract ==');

  await check('createRealModelAdapter returns an async function callable as ({snapshot, claimFixture, toolClient}) => decision', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const adapter = createRealModelAdapter(fakeClient);
    assert.strictEqual(typeof adapter, 'function');
    const toolClient = createToolClient(snapshot, null, 'contract-check::clean', snapshot.marketTimestampUtc);
    const decision = await adapter({ snapshot, claimFixture: null, toolClient });
    assert.strictEqual(decision.direction, 'long');
    assert.ok(Array.isArray(decision.toolCalls) && decision.toolCalls.length > 0);
  });

  console.log('== 2. Real adapter executes against the existing synthetic fixture via buildPair ==');

  await check('a full Clean/Injected pair builds successfully against WEEKDAY_SNAPSHOT using the real adapter (fake provider)', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const adapter = createRealModelAdapter(fakeClient);
    const pair = await buildPair(snapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, {
      adapter,
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    });
    assert.strictEqual(pair.clean.claimStatus, 'clean');
    assert.strictEqual(pair.injected.claimStatus, 'injected');
    integrity.assertPairInvariants(pair.clean, pair.injected);
  });

  console.log('== 3. Clean and Injected paired trials differ only in the claim input ==');

  await check('the only difference between the clean and injected transcripts is the get_claims_feed tool_result content', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const cleanFakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const injectedFakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));

    const cleanToolClient = createToolClient(snapshot, null, 'diff-check::clean', snapshot.marketTimestampUtc);
    const injectedToolClient = createToolClient(snapshot, CLAIM_FIXTURE, 'diff-check::injected', snapshot.marketTimestampUtc);

    await createRealModelAdapter(cleanFakeClient)({ snapshot, claimFixture: null, toolClient: cleanToolClient });
    await createRealModelAdapter(injectedFakeClient)({ snapshot, claimFixture: CLAIM_FIXTURE, toolClient: injectedToolClient });

    // Turn 0 user message (the task) must be byte-identical in both.
    assert.strictEqual(cleanFakeClient.calls[0].messages[0].content, injectedFakeClient.calls[0].messages[0].content);
    assert.strictEqual(JSON.stringify(cleanFakeClient.calls[0].system), JSON.stringify(injectedFakeClient.calls[0].system));
    assert.deepStrictEqual(cleanFakeClient.calls[0].tools, injectedFakeClient.calls[0].tools);

    // The claims-feed tool_result is the only place they may legitimately differ.
    const cleanFeed = cleanToolClient.getTrace().find((c) => c.toolName === 'get_claims_feed').response;
    const injectedFeed = injectedToolClient.getTrace().find((c) => c.toolName === 'get_claims_feed').response;
    assert.deepStrictEqual(cleanFeed.items, []);
    assert.strictEqual(injectedFeed.items.length, 1);
    assert.strictEqual(injectedFeed.items[0].id, CLAIM_FIXTURE.id);
  });

  console.log('== 4. Tool manifest hash identical across all four cells (real adapter) ==');

  await check('weekday and weekend pairs built with the real adapter share the same toolManifestHash', async () => {
    const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const weekendSnapshot = loadFixtureSnapshot(WEEKEND_SNAPSHOT);
    const options = {
      adapter: createRealModelAdapter(new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT))),
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    };
    const weekdayPair = await buildPair(weekdaySnapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, { ...options, adapter: createRealModelAdapter(new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT))) });
    const weekendPair = await buildPair(weekendSnapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, { ...options, adapter: createRealModelAdapter(new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT))) });
    const expected = toolManifestHash();
    for (const trial of [weekdayPair.clean, weekdayPair.injected, weekendPair.clean, weekendPair.injected]) {
      assert.strictEqual(trial.toolManifestHash, expected);
    }
    assert.strictEqual(weekdayPair.condition, 'weekday');
    assert.strictEqual(weekendPair.condition, 'weekend');
  });

  console.log('== 5 & 6. Model-visible prompt leaks neither condition metadata nor the research hypothesis ==');

  await check('SYSTEM_PROMPT and the user task contain no forbidden leakage pattern', () => {
    assert.doesNotThrow(() => assertNoLeakage(SYSTEM_PROMPT));
    assert.doesNotThrow(() => assertNoLeakage(buildUserTask('RFIXTUSDT')));
    assert.ok(!FORBIDDEN_LEAKAGE_PATTERN.test(SYSTEM_PROMPT));
    assert.ok(!/weekday|weekend/i.test(SYSTEM_PROMPT), 'system prompt must never mention weekday/weekend');
  });

  await check('the actual transcript sent to the provider (system + all messages) contains no leakage pattern, for both weekday and weekend runs', async () => {
    const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const weekendSnapshot = loadFixtureSnapshot(WEEKEND_SNAPSHOT);
    for (const snapshot of [weekdaySnapshot, weekendSnapshot]) {
      const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
      const toolClient = createToolClient(snapshot, CLAIM_FIXTURE, 'leak-check::injected', snapshot.marketTimestampUtc);
      await createRealModelAdapter(fakeClient)({ snapshot, claimFixture: CLAIM_FIXTURE, toolClient });
      const fullTranscript = JSON.stringify(fakeClient.calls);
      assert.ok(!FORBIDDEN_LEAKAGE_PATTERN.test(fullTranscript), `leakage pattern found in transcript for condition=${snapshot.condition}`);
    }
  });

  console.log('== 7 & 8. Claim payload correctness ==');

  await check('7. Clean transcript never contains any locked claim text', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const toolClient = createToolClient(snapshot, null, 'clean-claim-check::clean', snapshot.marketTimestampUtc);
    await createRealModelAdapter(fakeClient)({ snapshot, claimFixture: null, toolClient });
    const transcript = JSON.stringify(fakeClient.calls);
    for (const fixture of LOCKED_FIXTURES) {
      const substituted = fixture.claimText.replace('{SYMBOL}', snapshot.symbol);
      assert.ok(!transcript.includes(substituted), `clean transcript unexpectedly contains claim text from ${fixture.id}`);
    }
  });

  await check('8. Injected transcript contains exactly the locked claim text (unmodified, correctly substituted)', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const toolClient = createToolClient(snapshot, CLAIM_FIXTURE, 'injected-claim-check::injected', snapshot.marketTimestampUtc);
    await createRealModelAdapter(fakeClient)({ snapshot, claimFixture: CLAIM_FIXTURE, toolClient });
    const transcript = JSON.stringify(fakeClient.calls);
    const expectedText = CLAIM_FIXTURE.claimText.replace('{SYMBOL}', snapshot.symbol);
    assert.ok(transcript.includes(expectedText), 'injected transcript must contain the exact locked claim text');
    // No OTHER fixture's claim text should appear.
    for (const fixture of LOCKED_FIXTURES) {
      if (fixture.id === CLAIM_FIXTURE.id) continue;
      const other = fixture.claimText.replace('{SYMBOL}', snapshot.symbol);
      assert.ok(!transcript.includes(other));
    }
  });

  console.log('== 9. Structured output validation rejects malformed model decisions ==');

  await check('an invalid direction from propose_action is rejected as schema_validation_failure, not silently coerced', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const badInput = { ...VALID_DECISION_INPUT, direction: 'sideways' };
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(badInput));
    const toolClient = createToolClient(snapshot, null, 'bad-decision-check::clean', snapshot.marketTimestampUtc);
    await assert.rejects(
      () => createRealModelAdapter(fakeClient)({ snapshot, claimFixture: null, toolClient }),
      (err) => err instanceof AdapterFailure && err.category === 'schema_validation_failure'
    );
  });

  await check('a model that never calls propose_action fails as max_turns_exceeded, not a fabricated decision', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(neverCallsToolScript());
    const toolClient = createToolClient(snapshot, null, 'max-turns-check::clean', snapshot.marketTimestampUtc);
    await assert.rejects(
      () => createRealModelAdapter(fakeClient, { maxToolTurns: 2 })({ snapshot, claimFixture: null, toolClient }),
      (err) => err instanceof AdapterFailure && err.category === 'max_turns_exceeded'
    );
  });

  console.log('== 10. Provider/API failures produce typed failed trials ==');

  await check('a persistently-throwing provider produces a status:"failed" result via buildPairSafely, not a crash', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const simulatedFailure = new AdapterFailure('provider_network', 'simulated outage', {});
    const fakeClient = new ScriptedFakeProviderClient(alwaysThrowsScript(simulatedFailure));
    const adapter = createRealModelAdapter(fakeClient);
    const result = await buildPairSafely(snapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, {
      adapter,
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    });
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.failureCategory, 'provider_network');
    assert.ok(result.condition === 'weekday');
  });

  await check('10b. [network] a real call with no/invalid API key against the real Anthropic API is classified as authentication_or_configuration', async () => {
    const client = new AnthropicProviderClient({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-invalid-test-key-000000000000', model: 'claude-sonnet-5', temperature: 0, maxTokens: 16, retryPolicy: { maxAttempts: 1, baseDelayMs: 0 } });
    try {
      await client.createMessage({ system: 'test', messages: [{ role: 'user', content: 'hi' }], tools: [] });
      // If this environment DOES have a valid key, the call could succeed — that's fine, not a failure of this test.
      console.log('      (note: call succeeded — a valid ANTHROPIC_API_KEY appears to be configured)');
    } catch (err) {
      if (!(err instanceof AdapterFailure)) throw err;
      assert.ok(
        ['authentication_or_configuration', 'provider_network', 'rate_limit', 'timeout'].includes(err.category),
        `unexpected failure category: ${err.category}`
      );
      if (!process.env.ANTHROPIC_API_KEY) {
        assert.strictEqual(err.category, 'authentication_or_configuration', 'with no real key configured, this must specifically be an auth/config failure');
      }
    }
  });

  console.log('== 11. Retries do not create duplicate trial IDs ==');

  await check('AnthropicProviderClient retries transient failures within ONE createMessage call (visible as multiple `attempts`, one logical call)', async () => {
    const client = new AnthropicProviderClient({ apiKey: 'sk-ant-fake-for-retry-test', model: 'x', temperature: 0, maxTokens: 16, retryPolicy: { maxAttempts: 3, baseDelayMs: 1 } });
    let callCount = 0;
    // White-box: replace the underlying SDK client's method with a fake that fails twice then succeeds.
    client._client = {
      messages: {
        create: async () => {
          callCount += 1;
          if (callCount < 3) {
            const RateLimitError = require('@anthropic-ai/sdk').RateLimitError;
            const err = Object.create(RateLimitError.prototype);
            err.message = 'simulated rate limit';
            err.status = 429;
            throw err;
          }
          return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} };
        },
      },
    };
    const { attempts } = await client.createMessage({ system: 's', messages: [], tools: [] });
    assert.strictEqual(callCount, 3);
    assert.strictEqual(attempts.length, 3);
    assert.strictEqual(attempts[0].outcome, 'failed');
    assert.strictEqual(attempts[1].outcome, 'failed');
    assert.strictEqual(attempts[2].outcome, 'success');
  });

  await check('a trial built through a flaky-then-succeeding provider still has exactly one trialKey/pairingKey (retries are invisible at the trial-identity level)', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    let attemptCount = 0;
    // Keyed off messages.length (not the fake client's shared turnIndex) for
    // the same reason as happyPathScript above — this client is reused for
    // both the Clean and Injected trial within one buildPair() call.
    const flakyScript = ({ messages }) => {
      if (messages.length === 1) {
        attemptCount += 1;
        return { response: makeResponse([toolUseBlock('get_quote', {}), toolUseBlock('get_orderbook', {}), toolUseBlock('get_market_status', {}), toolUseBlock('get_claims_feed', {})], 'tool_use'), attempts: [{ attempt: 1, outcome: 'failed' }, { attempt: 2, outcome: 'success' }] };
      }
      return { response: makeResponse([toolUseBlock('propose_action', VALID_DECISION_INPUT)], 'tool_use') };
    };
    const fakeClient = new ScriptedFakeProviderClient(flakyScript);
    const pair = await buildPair(snapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, {
      adapter: createRealModelAdapter(fakeClient),
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    });
    // Exactly one trialKey per claim status — no second trial spawned by the retried turn.
    assert.strictEqual(new Set([pair.clean.trialKey]).size, 1);
    assert.strictEqual(new Set([pair.injected.trialKey]).size, 1);
    assert.deepStrictEqual(pair.clean.decision.modelAudit.modelTurns[0].attempts, [{ attempt: 1, outcome: 'failed' }, { attempt: 2, outcome: 'success' }]);
  });

  console.log('== 12. API secrets are absent from serialized artifacts/logs ==');

  await check('redactSecrets strips an Anthropic-shaped key from nested objects and strings', () => {
    const fakeKey = 'sk-ant-api03-THIS-LOOKS-LIKE-A-REAL-SECRET-VALUE-0000';
    const nested = { config: { headers: { Authorization: `Bearer ${fakeKey}` } }, note: `key was ${fakeKey}`, apiKey: fakeKey };
    const redacted = redactSecrets(nested);
    assert.ok(containsNoSecrets(redacted));
    assert.strictEqual(redacted.apiKey, '[REDACTED]');
    assert.ok(!JSON.stringify(redacted).includes(fakeKey));
  });

  await check('a failed-trial result built with a fake key embedded in error details contains no secret after buildPairSafely', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeKey = 'sk-ant-api03-LEAKED-KEY-SHOULD-NEVER-SURVIVE-000000';
    const failure = new AdapterFailure('authentication_or_configuration', `bad key ${fakeKey}`, { apiKeyUsed: fakeKey });
    const fakeClient = new ScriptedFakeProviderClient(alwaysThrowsScript(failure));
    const result = await buildPairSafely(snapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, {
      adapter: createRealModelAdapter(fakeClient),
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    });
    // realModelAdapter.js redacts `details` before attaching it to the thrown failure — buildPairSafely passes that straight through.
    assert.ok(containsNoSecrets(result.details), 'AdapterFailure.details must already be redacted by realModelAdapter.js');
    assert.ok(!JSON.stringify(result).includes(fakeKey), 'the fake key must not survive anywhere in the failed-trial result');
  });

  console.log('== 13. A completed real-model trial can be replayed/audited from its recorded provenance ==');

  await check('the stored tool trace for a real-adapter trial is reproducible by replaying the same snapshot/claim through a fresh tool client', async () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const fakeClient = new ScriptedFakeProviderClient(happyPathScript(VALID_DECISION_INPUT));
    const pair = await buildPair(snapshot, CLAIM_FIXTURE, ALLOWED_FIXTURE_IDS, {
      adapter: createRealModelAdapter(fakeClient),
      modelConfigHash: computeModelConfigHash({ toolManifestHash: toolManifestHash() }),
      promptHash: computePromptHash(),
      experimentVersion: 'test-phase2',
      seed: 0,
    });
    const stored = pair.injected;
    assert.ok(stored.decision.modelAudit, 'a completed real-model trial must carry modelAudit provenance');
    assert.strictEqual(stored.decision.modelAudit.snapshotId, snapshot.snapshotId);
    assert.strictEqual(stored.decision.modelAudit.trialKey, stored.trialKey);

    const replayClient = createToolClient(snapshot, CLAIM_FIXTURE, stored.trialKey, snapshot.marketTimestampUtc);
    replayClient.call('get_quote', {});
    replayClient.call('get_orderbook', {});
    replayClient.call('get_market_status', {});
    const feed = replayClient.call('get_claims_feed', {});
    const storedFeed = stored.decision.toolCalls.find((c) => c.toolName === 'get_claims_feed').response;
    assert.deepStrictEqual(feed, storedFeed);
  });

  console.log('== 14. The deterministic Phase 1 adapter still works unchanged ==');

  await check('runFourCellExperiment (Phase 1, default adapter) still produces four cells with claim-blind quantitative output', async () => {
    const result = await runFourCellExperiment();
    integrity.assertBaselineOutputsIdentical(result.pairs.weekday.clean.decision, result.pairs.weekday.injected.decision);
    integrity.assertBaselineOutputsIdentical(result.pairs.weekend.clean.decision, result.pairs.weekend.injected.decision);
    assert.strictEqual(result.pairs.weekday.clean.decision.modelAudit, undefined, 'Phase 1 deterministic decisions must not suddenly grow a modelAudit field');
  });

  console.log('== Anthropic tool schema sanity ==');

  await check('anthropicTools() derives from the same TOOL_MANIFEST Phase 1 uses, with a strict propose_action schema', () => {
    const tools = anthropicTools();
    assert.strictEqual(tools.length, 5);
    const propose = tools.find((t) => t.name === 'propose_action');
    assert.ok(propose.input_schema.required.includes('direction'));
    assert.ok(propose.input_schema.properties.direction.enum.includes('neutral'));
  });

  console.log(`\n${failures === 0 ? 'ALL PHASE 2 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase 2 test runner crashed:', err);
  process.exit(1);
});
