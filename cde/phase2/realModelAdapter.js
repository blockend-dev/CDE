'use strict';
/**
 * The real-model adapter — Phase 2's entire reason to exist.
 *
 * createRealModelAdapter(providerClient) returns a function with EXACTLY
 * the same signature as cde/phase1/adapter.js's deterministicTestAdapter:
 *
 *   async ({ snapshot, claimFixture, toolClient }) => decision
 *
 * That is the whole integration surface. cde/phase1/trial.js does not
 * know or care whether the function it calls is the Phase 1 fixture or
 * this one — see cde/phase1/trial.js's `adapter` option.
 *
 * The model interacts ONLY through toolClient.call(), which is the exact
 * same deterministic, snapshot-backed replay client Phase 1 already uses
 * (cde/phase1/toolReplay.js) — no live Bitget data, no filesystem, no
 * network access of its own. The one real network call this file makes is
 * to the model provider itself, via providerClient (cde/phase2/provider/).
 */

const { SYSTEM_PROMPT, buildUserTask, assertNoLeakage } = require('./prompt');
const { anthropicTools } = require('./schema');
const { validateDecision } = require('../lib/decision');
const { AdapterFailure } = require('./failures');
const { redactSecrets } = require('./secretRedaction');
const { MAX_TOOL_TURNS } = require('./config');

function toolResultBlock(toolUseBlock, response) {
  return { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(response) };
}

function createRealModelAdapter(providerClient, { maxToolTurns = MAX_TOOL_TURNS } = {}) {
  return async function realModelAdapter({ snapshot, claimFixture, toolClient }) {
    const trialKey = toolClient.getTrialKey();
    const userTask = buildUserTask(snapshot.symbol);
    assertNoLeakage(SYSTEM_PROMPT);
    assertNoLeakage(userTask);

    const messages = [{ role: 'user', content: userTask }];
    const tools = anthropicTools();
    const modelTurns = []; // audit trail of raw provider interactions (redacted before it ever leaves this function)

    let finalDecisionInput = null;
    let verificationAttempts = [];

    for (let turn = 1; turn <= maxToolTurns && !finalDecisionInput; turn++) {
      let envelope;
      try {
        envelope = await providerClient.createMessage({ system: SYSTEM_PROMPT, messages, tools });
      } catch (err) {
        const failure = err instanceof AdapterFailure ? err : new AdapterFailure('provider_network', String(err && err.message), {});
        modelTurns.push({ turn, error: { category: failure.category, message: failure.message } });
        // Attach what we have so far to the failure for provenance, then propagate —
        // this trial is FAILED, not silently recovered into a fabricated decision.
        failure.details = redactSecrets({ ...failure.details, trialKey, modelTurns });
        throw failure;
      }

      const { response, attempts } = envelope;
      modelTurns.push({ turn, stopReason: response.stop_reason, usage: response.usage, attempts, contentSummary: summarizeContent(response.content) });
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        // Model responded without calling any tool — nudge once, per the
        // prompt's own instruction that propose_action is the only valid
        // way to answer, rather than silently accepting prose as a result.
        messages.push({ role: 'user', content: 'Please call the propose_action tool to submit your decision — a plain-text answer cannot be recorded.' });
        continue;
      }

      const toolResultBlocks = [];
      for (const block of toolUseBlocks) {
        if (block.name === 'propose_action') {
          finalDecisionInput = block.input;
          // Still echo a tool_result so the transcript stays well-formed if the
          // model (incorrectly) calls another tool in the same turn.
          const echoed = toolClient.call('propose_action', block.input);
          toolResultBlocks.push(toolResultBlock(block, echoed));
          continue;
        }
        let toolResponse;
        try {
          toolResponse = toolClient.call(block.name, block.input || {});
        } catch (err) {
          throw new AdapterFailure('tool_invocation_failure', `Tool call "${block.name}" failed: ${err.message}`, { trialKey, turn });
        }
        if (block.name !== 'get_claims_feed') {
          verificationAttempts.push({ tool: block.name, purpose: 'model_requested' });
        } else {
          verificationAttempts.push({ tool: block.name, purpose: 'claim_seen_not_acted_on_by_construction' });
        }
        toolResultBlocks.push(toolResultBlock(block, toolResponse));
      }
      if (toolResultBlocks.length > 0) messages.push({ role: 'user', content: toolResultBlocks });
    }

    if (!finalDecisionInput) {
      throw new AdapterFailure('max_turns_exceeded', `Model did not call propose_action within ${maxToolTurns} turns.`, { trialKey, modelTurns: redactSecrets(modelTurns) });
    }

    const claimPresent = !!claimFixture;
    // claimAssessment for the NO-CLAIM case is ground truth the harness
    // controls (cde/phase1/integrity.js requires every Clean trial's
    // decision.claimAssessment === 'no_claim_presented'), not something a
    // model self-report should be trusted for — a model could hallucinate
    // "uncertain" even having seen an empty claims feed. When a claim WAS
    // presented, the model's own judgement (accepted/rejected/uncertain) is
    // exactly what's being measured and is preserved as-is.
    const modelReportedMismatch = !claimPresent && finalDecisionInput.claimAssessment !== 'no_claim_presented';
    const claimAssessment = claimPresent ? finalDecisionInput.claimAssessment : 'no_claim_presented';
    const decision = {
      direction: finalDecisionInput.direction,
      exposure: finalDecisionInput.exposure,
      confidence: finalDecisionInput.confidence,
      claimAssessment,
      verificationAttempts,
      toolCalls: toolClient.getTrace(),
      rationaleSummary: typeof finalDecisionInput.rationaleSummary === 'string' ? finalDecisionInput.rationaleSummary : '',
      modelAudit: redactSecrets({
        provider: 'anthropic',
        trialKey,
        snapshotId: toolClient.getSnapshotId(),
        claimPresent,
        modelReportedClaimAssessmentMismatch: modelReportedMismatch, // true if the model said something other than no_claim_presented despite no claim existing — interesting on its own, but never allowed to violate the Clean-trial invariant
        turnsUsed: modelTurns.length,
        modelTurns,
      }),
    };

    try {
      validateDecision(decision);
    } catch (err) {
      throw new AdapterFailure('schema_validation_failure', `Model output failed decision schema validation: ${err.message}`, { trialKey, rawInput: redactSecrets(finalDecisionInput) });
    }

    return decision;
  };
}

function summarizeContent(content) {
  // Keeps the audit trail informative without duplicating full text/thinking
  // blocks (which could be long) into every provenance record. Every branch
  // produces a fully-populated object (no `undefined` fields) regardless of
  // block type — some real model responses include block types (e.g.
  // `thinking`) this wasn't originally written to expect.
  return content.map((b) => {
    if (b.type === 'tool_use') return { type: 'tool_use', name: b.name };
    if (b.type === 'text') return { type: 'text', length: b.text.length };
    return { type: b.type };
  });
}

module.exports = { createRealModelAdapter };
