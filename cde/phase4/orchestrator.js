'use strict';
/**
 * Research-run orchestrator. Thin by design — it coordinates
 * population -> snapshot selection -> pair construction -> validation ->
 * immutable artifact, but does not reimplement any of it: pair
 * construction and completed/failed classification are exactly
 * cde/phase2/runRealModelExperiment.js: buildPairSafely(), unchanged.
 *
 * Idempotent / resumable by construction: every candidate's artifact
 * filename is its own content-addressed snapshotId (real data in, real
 * deterministic id out — see cde/phase4/replaySnapshot.js). Before
 * attempting a candidate, the orchestrator checks whether
 * trials/<snapshotId>.json or failures/<snapshotId>.json already exists
 * and skips it if so. A crash and restart can therefore never duplicate
 * an observation — it just resumes from wherever the run directory says
 * it left off.
 *
 * Claim-fixture assignment: deterministic round-robin over the six locked
 * fixtures (cde/lib/corpus.js: LOCKED_FIXTURES), keyed by each candidate's
 * fixed position in the deterministic population queue — never by outcome,
 * decided once, before any model call, and recorded per-artifact.
 */

const fs = require('fs');
const path = require('path');

const { buildCandidateQueues } = require('./population');
const { buildPairSafely } = require('../phase2/runRealModelExperiment');
const { createRealModelAdapter } = require('../phase2/realModelAdapter');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { contentHash } = require('../lib/hash');
const { redactSecrets, containsNoSecrets } = require('../phase2/secretRedaction');
const { MIN_COMPLETED_PAIRS_PER_CONDITION, MAX_ATTEMPTED_PAIRS } = require('../analysis/lib/sampleSizeAssessment');

const RUNS_DIR = path.join(__dirname, '..', 'runs');

function runDirFor(runId) {
  return path.join(RUNS_DIR, runId);
}

function ensureRunDirs(runId) {
  const runDir = runDirFor(runId);
  const trialsDir = path.join(runDir, 'trials');
  const failuresDir = path.join(runDir, 'failures');
  fs.mkdirSync(trialsDir, { recursive: true });
  fs.mkdirSync(failuresDir, { recursive: true });
  return { runDir, trialsDir, failuresDir };
}

/** Writes manifest.json once. Refuses to silently overwrite a DIFFERENT manifest under the same run ID (immutability). */
function writeManifestOnce(runDir, manifest) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (existing.manifestHash !== manifest.manifestHash) {
      throw new Error(`Run directory ${runDir} already has a manifest with a different manifestHash — refusing to overwrite. Use a new runId for a different configuration.`);
    }
    return existing;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function artifactPath(dir, snapshotId) {
  return path.join(dir, `${snapshotId}.json`);
}

/** Idempotent write: only writes if no artifact already exists for this snapshotId (completed OR failed — an attempt is an attempt). */
function writeArtifactIfAbsent({ trialsDir, failuresDir }, snapshotId, outcome) {
  const alreadyCompleted = fs.existsSync(artifactPath(trialsDir, snapshotId));
  const alreadyFailed = fs.existsSync(artifactPath(failuresDir, snapshotId));
  if (alreadyCompleted || alreadyFailed) return { written: false, reason: 'already_attempted' };

  const redacted = redactSecrets(outcome);
  if (!containsNoSecrets(redacted)) throw new Error(`Refusing to write artifact for ${snapshotId}: possible secret detected even after redaction.`);

  const targetDir = outcome.status === 'completed' ? trialsDir : failuresDir;
  fs.writeFileSync(artifactPath(targetDir, snapshotId), JSON.stringify(redacted, null, 2));
  return { written: true };
}

function countCompletedByCondition(trialsDir) {
  const counts = { weekday: 0, weekend: 0 };
  if (!fs.existsSync(trialsDir)) return counts;
  for (const file of fs.readdirSync(trialsDir)) {
    if (!file.endsWith('.json')) continue;
    const content = JSON.parse(fs.readFileSync(path.join(trialsDir, file), 'utf8'));
    if (content.condition === 'weekday' || content.condition === 'weekend') counts[content.condition] += 1;
  }
  return counts;
}

function countAttempted(trialsDir, failuresDir) {
  const c = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0);
  return c(trialsDir) + c(failuresDir);
}

function alreadyAttemptedSnapshotIds(trialsDir, failuresDir) {
  const ids = new Set();
  for (const dir of [trialsDir, failuresDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.json')) ids.add(file.slice(0, -'.json'.length));
    }
  }
  return ids;
}

function stoppingConditionMet(counts, attempted) {
  const meetsTarget = counts.weekday >= MIN_COMPLETED_PAIRS_PER_CONDITION && counts.weekend >= MIN_COMPLETED_PAIRS_PER_CONDITION;
  const exhausted = attempted >= MAX_ATTEMPTED_PAIRS;
  return { stop: meetsTarget || exhausted, meetsTarget, exhausted };
}

/**
 * Executes (or resumes) a research run. Sequential by design (conservative
 * concurrency, per the brief) and interleaves weekday/weekend attempts to
 * avoid any systematic time-of-execution drift landing disproportionately
 * on one condition.
 *
 * @param {object} manifest from cde/phase4/runManifest.js: buildRunManifest()
 * @param {object} providerClient a cde/phase2/provider/anthropicClient.js: AnthropicProviderClient instance
 * @param {object} [opts] { onProgress(update) }
 */
async function runResearchCollection(manifest, providerClient, opts = {}) {
  const { runDir, trialsDir, failuresDir } = ensureRunDirs(manifest.runId);
  writeManifestOnce(runDir, manifest);

  const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
  const adapter = createRealModelAdapter(providerClient);
  const allowedFixtureIds = LOCKED_FIXTURES.map((f) => f.id);

  const done = alreadyAttemptedSnapshotIds(trialsDir, failuresDir);
  let counts = countCompletedByCondition(trialsDir);
  let attempted = countAttempted(trialsDir, failuresDir);

  let wdIdx = 0;
  let weIdx = 0;
  let fixtureCycle = attempted; // resumable: continue the deterministic round-robin from where prior progress left off

  function nextUnattempted(queue, startIdxRef) {
    while (startIdxRef.i < queue.length) {
      const candidate = queue[startIdxRef.i];
      startIdxRef.i += 1;
      if (!done.has(candidate.snapshot.snapshotId)) return candidate;
    }
    return null;
  }

  async function attemptOne(candidate) {
    const claimFixture = LOCKED_FIXTURES[fixtureCycle % LOCKED_FIXTURES.length];
    fixtureCycle += 1;

    const outcome = await buildPairSafely(candidate.snapshot, claimFixture, allowedFixtureIds, { adapter });
    const stamped = { ...outcome, runId: manifest.runId, manifestHash: manifest.manifestHash, candidateSnapshotId: candidate.snapshot.snapshotId, attemptedAtUtc: new Date().toISOString() };
    writeArtifactIfAbsent({ trialsDir, failuresDir }, candidate.snapshot.snapshotId, stamped);
    done.add(candidate.snapshot.snapshotId);

    if (outcome.status === 'completed') counts[outcome.condition] += 1;
    attempted += 1;
    if (opts.onProgress) opts.onProgress({ counts: { ...counts }, attempted, lastOutcome: outcome.status, condition: outcome.condition });
  }

  const wdRef = { i: wdIdx };
  const weRef = { i: weIdx };

  while (true) {
    const { stop } = stoppingConditionMet(counts, attempted);
    if (stop) break;

    const weekdayCandidate = nextUnattempted(weekdayCandidates, wdRef);
    if (weekdayCandidate) await attemptOne(weekdayCandidate);

    const { stop: stopAfterWeekday } = stoppingConditionMet(counts, attempted);
    if (stopAfterWeekday) break;

    const weekendCandidate = nextUnattempted(weekendCandidates, weRef);
    if (weekendCandidate) await attemptOne(weekendCandidate);

    if (!weekdayCandidate && !weekendCandidate) {
      // Population exhausted before the stopping rule was reached — stop honestly, do not fabricate more candidates.
      break;
    }
  }

  const final = stoppingConditionMet(counts, attempted);
  return { runId: manifest.runId, runDir, counts, attempted, stoppingRule: final };
}

module.exports = { runResearchCollection, ensureRunDirs, countCompletedByCondition, countAttempted, stoppingConditionMet, writeArtifactIfAbsent, writeManifestOnce, RUNS_DIR, runDirFor };
