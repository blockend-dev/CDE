'use strict';
/**
 * Research-run manifest — frozen and written BEFORE the first research
 * model call. Captures everything needed to recover the exact
 * configuration a run used without relying on mutable .env values as the
 * only record (Phase 4 §2).
 */

const { execSync } = require('child_process');
const { contentHash } = require('../lib/hash');
const { computeLock: computeMethodologyLock } = require('../lib/methodologyLock');
const { computeLock: computeAnalysisLock } = require('../analysis/lib/analysisLock');
const { toolManifestHash } = require('../lib/tools');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { promptHash: computePromptHash } = require('../phase2/prompt');
const { modelConfigHash: computeModelConfigHash, MODEL, PROVIDER, TEMPERATURE, MAX_TOKENS, MAX_TOOL_TURNS, PROMPT_VERSION, ADAPTER_VERSION, RETRY_POLICY } = require('../phase2/config');
const { MIN_COMPLETED_PAIRS_PER_CONDITION, MAX_ATTEMPTED_PAIRS } = require('../analysis/lib/sampleSizeAssessment');

// cmd.exe (Node's default Windows shell for execSync) cannot start in a
// UNC working directory ("UNC paths are not supported") — this repo lives
// under \\wsl.localhost\... , so a shell that does support it is required.
// bash.exe (already relied on elsewhere in this project's tooling) works;
// falls back to the platform default elsewhere.
const GIT_SHELL = process.platform === 'win32' ? 'bash.exe' : undefined;
const REPO_ROOT = require('path').join(__dirname, '..', '..');

function runGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, shell: GIT_SHELL }).toString().trim();
}

function currentCommitSha() {
  try {
    return runGit('rev-parse HEAD');
  } catch (_) {
    return null; // e.g. run outside a git repo — recorded honestly as unknown, never guessed
  }
}

function isWorkingTreeClean() {
  try {
    return runGit('status --porcelain').length === 0;
  } catch (_) {
    return null;
  }
}

function runIdFor(startedAtUtc) {
  return `run-${startedAtUtc.replace(/[:.]/g, '').replace('Z', 'Z')}`;
}

/**
 * Builds the manifest. `startedAtUtc` is the one deliberate wall-clock
 * read in this whole module (a run genuinely happens at a real time) —
 * everything else is derived from frozen, versioned sources.
 */
function buildRunManifest({ startedAtUtc = new Date().toISOString() } = {}) {
  const methodologyLock = computeMethodologyLock();
  const analysisLock = computeAnalysisLock();
  const toolManifestHashValue = toolManifestHash();
  const modelConfigHashValue = computeModelConfigHash({ toolManifestHash: toolManifestHashValue });
  const attackCorpusHash = contentHash(LOCKED_FIXTURES);

  const manifestCore = {
    runId: runIdFor(startedAtUtc),
    startedAtUtc,
    methodologyLockHash: methodologyLock.contentHash,
    analysisLockHash: analysisLock.contentHash,
    provider: PROVIDER,
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    maxToolTurns: MAX_TOOL_TURNS,
    retryPolicy: RETRY_POLICY,
    modelConfigHash: modelConfigHashValue,
    promptVersion: PROMPT_VERSION,
    promptHash: computePromptHash(),
    toolManifestHash: toolManifestHashValue,
    attackCorpusHash,
    adapterVersion: ADAPTER_VERSION,
    experimentVersion: ADAPTER_VERSION,
    analysisSeed: analysisLock.analysisSeed,
    targetMinCompletedPairsPerCondition: MIN_COMPLETED_PAIRS_PER_CONDITION,
    maxAttemptedPairs: MAX_ATTEMPTED_PAIRS,
    repositoryCommitSha: currentCommitSha(),
    workingTreeCleanAtStart: isWorkingTreeClean(),
    nodeVersion: process.version,
    packageVersions: (() => {
      try {
        const fs = require('fs');
        const path = require('path');
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        const sdkPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', '@anthropic-ai', 'sdk', 'package.json'), 'utf8'));
        return { self: pkg.version, anthropicSdk: sdkPkg.version };
      } catch (_) {
        return null;
      }
    })(),
  };

  return { ...manifestCore, manifestHash: contentHash(manifestCore) };
}

module.exports = { buildRunManifest, runIdFor, currentCommitSha, isWorkingTreeClean };
