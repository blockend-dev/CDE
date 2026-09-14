'use strict';
/**
 * CLI entrypoint for the real, research-scale collection run. Wires the
 * real AnthropicProviderClient (cde/phase2/provider/anthropicClient.js) —
 * the exact one that already passed the Phase 2 smoke test — into
 * cde/phase4/orchestrator.js. Nothing about pairing, prompts, tools, or
 * the attack corpus is touched here; this file only assembles already-
 * built pieces and reports progress by COUNT only (never by outcome
 * content — see ANALYSIS_PLAN.md / Phase 4 "no interim analysis").
 *
 * Usage: node cde/phase4/runResearch.js
 * Requires ANTHROPIC_API_KEY in the environment (e.g. via `.env`, loaded
 * by the caller — this file does not read .env itself, consistent with
 * "do not rely on mutable .env values as the only record" for the
 * manifest, though the key itself must still come from the environment).
 */

const { buildRunManifest } = require('./runManifest');
const { runResearchCollection } = require('./orchestrator');
const { AnthropicProviderClient } = require('../phase2/provider/anthropicClient');
const { apiKey, MODEL, TEMPERATURE, MAX_TOKENS, RETRY_POLICY } = require('../phase2/config');

async function main() {
  const manifest = buildRunManifest();
  console.log('=== PHASE 4 RESEARCH COLLECTION ===');
  console.log('runId:', manifest.runId);
  console.log('manifestHash:', manifest.manifestHash);
  console.log('methodologyLockHash:', manifest.methodologyLockHash);
  console.log('analysisLockHash:', manifest.analysisLockHash);
  console.log('model:', manifest.model);
  console.log('repositoryCommitSha:', manifest.repositoryCommitSha);
  console.log('workingTreeCleanAtStart:', manifest.workingTreeCleanAtStart);
  console.log('target:', manifest.targetMinCompletedPairsPerCondition, 'per condition, cap', manifest.maxAttemptedPairs, 'attempted pairs');
  console.log('');

  const providerClient = new AnthropicProviderClient({ apiKey: apiKey(), model: MODEL, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, retryPolicy: RETRY_POLICY });

  const result = await runResearchCollection(manifest, providerClient, {
    onProgress: (u) => {
      console.log(`[progress] weekday=${u.counts.weekday} weekend=${u.counts.weekend} attempted=${u.attempted} last=${u.lastOutcome}(${u.condition})`);
    },
  });

  console.log('');
  console.log('=== COLLECTION FINISHED ===');
  console.log('runId:', result.runId);
  console.log('runDir:', result.runDir);
  console.log('completed weekday:', result.counts.weekday);
  console.log('completed weekend:', result.counts.weekend);
  console.log('total attempted:', result.attempted);
  console.log('stoppingRule:', JSON.stringify(result.stoppingRule));
}

main().catch((err) => {
  console.error('Research collection run crashed:', err);
  process.exit(1);
});
