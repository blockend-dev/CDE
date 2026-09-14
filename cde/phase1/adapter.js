'use strict';
/**
 * Decision-adapter interface + the Phase 1 deterministic test adapter.
 *
 * The interface is the pluggable "model boundary": in Phase 2 this slot
 * gets a real LLM-backed adapter with the same call signature. Nothing
 * else in the harness (trial.js, runExperiment.js) needs to change when
 * that happens.
 *
 * The Phase 1 adapter is explicitly NOT that model. It is a fixture that
 * exercises the interface (it does receive the claim, it does make tool
 * calls, it does emit a structured decision) while remaining incapable of
 * producing the research effect: its quantitative output (direction,
 * exposure, confidence) is computed by delegating to the SAME claim-blind
 * baseline used as Phase 0's falsification control
 * (cde/lib/baseline.js: claimBlindBaseline), via the same
 * toMarketOnlyView() whitelist extraction. That delegation is what
 * guarantees — by construction, not by promise — that this adapter cannot
 * accidentally manufacture a Clean/Injected difference: it is structurally
 * using the one function in this repo already proven claim-blind.
 *
 * The claim is acknowledged only in non-quantitative metadata
 * (claimAssessment, rationaleSummary) and in triggering one additional,
 * declared verification attempt — never in the exposure/direction/confidence
 * fields that the causal metrics (cde/lib/metrics.js) actually read.
 */

const { toMarketOnlyView, claimBlindBaseline } = require('../lib/baseline');
const { validateDecision } = require('../lib/decision');

/**
 * @param {object} params
 * @param {object} params.snapshot   frozen snapshot (fixture or real)
 * @param {object|null} params.claimFixture  the injected claim, or null for Clean
 * @param {object} params.toolClient  from toolReplay.js: { call, getTrace }
 */
function deterministicTestAdapter({ snapshot, claimFixture, toolClient }) {
  // A real adapter would decide what to call and when; this fixture always
  // makes the same declared sequence, identically in every cell, which is
  // itself part of what "tool-surface invariance" means at the call-pattern
  // level, not just the manifest-definition level.
  toolClient.call('get_quote', { symbol: snapshot.symbol });
  toolClient.call('get_orderbook', { symbol: snapshot.symbol });
  toolClient.call('get_market_status', { symbol: snapshot.symbol });
  const claimsFeed = toolClient.call('get_claims_feed', { symbol: snapshot.symbol });

  const verificationAttempts = [
    { tool: 'get_quote', purpose: 'price_check' },
    { tool: 'get_orderbook', purpose: 'depth_check' },
  ];

  const marketOnlyView = toMarketOnlyView(snapshot); // structurally cannot contain claim data — see cde/lib/baseline.js
  const marketDecision = claimBlindBaseline(marketOnlyView);

  const claimPresent = claimsFeed.items.length > 0;
  const claimAssessment = claimPresent ? 'uncertain' : 'no_claim_presented';
  if (claimPresent) {
    verificationAttempts.push({ tool: 'get_claims_feed', purpose: 'claim_seen_not_acted_on' });
  }

  const decision = {
    direction: marketDecision.direction,
    exposure: marketDecision.exposure,
    confidence: marketDecision.confidence,
    claimAssessment,
    verificationAttempts,
    toolCalls: [], // filled in by trial.js after propose_action is logged, so the trace includes this very call
    rationaleSummary: claimPresent
      ? `claim observed (id=${claimsFeed.items[0].id}); phase1 fixture adapter — decision computed from market data only, not from claim content`
      : 'no claim observed; phase1 fixture adapter — decision computed from market data only',
  };

  toolClient.call('propose_action', decision);
  const finalDecision = { ...decision, toolCalls: toolClient.getTrace() };
  validateDecision(finalDecision);
  return finalDecision;
}

module.exports = { deterministicTestAdapter };
