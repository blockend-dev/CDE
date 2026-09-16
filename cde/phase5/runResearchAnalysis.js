'use strict';
/**
 * Phase 5B — executes ONLY the pre-registered, locked analysis
 * (cde/analysis/lib/runAnalysis.js) against a finalized Phase 4 run
 * directory, after Phase 5A's read-only preflight passes. Writes one
 * content-addressed analysis artifact, kept separate from the raw
 * evidence under cde/runs/. Never modifies the run directory.
 */

const fs = require('fs');
const path = require('path');

const { contentHash } = require('../lib/hash');
const { runPreflight, loadRawAttemptOutcomes } = require('./preflight');
const { runAnalysis } = require('../analysis/lib/runAnalysis');

const ANALYSIS_LIB_DIR = path.join(__dirname, '..', 'analysis', 'lib');
const ANALYSIS_CODE_FILES = [
  path.join(__dirname, '..', 'lib', 'metrics.js'),
  ...['analysisLock.js', 'inputValidation.js', 'primaryAnalysis.js', 'resampling.js', 'proportions.js', 'sampleSizeAssessment.js', 'secondaryAnalysis.js', 'stratification.js', 'runAnalysis.js'].map((f) =>
    path.join(ANALYSIS_LIB_DIR, f)
  ),
];

/** Fingerprints the exact analysis code this run executed against — independent of any git state. */
function analysisCodeFingerprint() {
  const files = ANALYSIS_CODE_FILES.map((abs) => {
    const rel = path.relative(path.join(__dirname, '..', '..'), path.resolve(abs)).split(path.sep).join('/');
    return { path: rel, content: fs.readFileSync(path.resolve(abs), 'utf8') };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { files: files.map((f) => f.path), hash: contentHash(files) };
}

const RESULTS_ROOT = path.join(__dirname, '..', 'analysis', 'results');

/**
 * @param {string} runDir e.g. cde/runs/<runId>
 * @param {object} expected {methodologyLockHash, analysisLockHash, datasetManifestHash}
 */
function runResearchAnalysis(runDir, expected) {
  const preflight = runPreflight(runDir, expected);
  if (!preflight.pass) {
    const failed = preflight.checks.filter((c) => !c.pass);
    const err = new Error(`Phase 5A preflight failed — refusing to run the analysis. Failed checks: ${failed.map((c) => c.name).join(', ')}`);
    err.preflight = preflight;
    throw err;
  }

  const runId = path.basename(runDir);
  const rawAttemptOutcomes = loadRawAttemptOutcomes(runDir);
  const result = runAnalysis(rawAttemptOutcomes); // no seed override — uses the locked default (analysisLock.ANALYSIS_SEED)
  const codeFingerprint = analysisCodeFingerprint();

  const analysisResultCore = {
    runId,
    datasetManifestHash: expected.datasetManifestHash,
    methodologyLockHash: result.methodologyLockHash,
    analysisLockHash: result.analysisLockHash,
    analysisPlanVersion: result.analysisPlanVersion,
    analysisCodeFingerprint: codeFingerprint,
    seedUsed: result.seedUsed,
    preflightPassed: true,
    preflightChecks: preflight.checks.map((c) => ({ name: c.name, pass: c.pass })),
    sampleSize: result.sampleSize,
    exclusions: result.exclusions,
    primary: result.primary,
    secondary: result.secondary,
    calendarPrior: result.calendarPrior,
    stratified: result.stratified,
    provenanceLimitations:
      'Snapshots are replayed from the research/weekend-informativeness precondition study, not fetched live during Phase 4. ' +
      'Within each snapshot, price.last / symbol / marketTimestampUtc are REAL historical Bitget observations; ' +
      'orderbook, volume, and candles are DERIVED placeholders (fixed synthetic spread, zero volume/OHLCV) never presented as independently observed. ' +
      'The exploratory BTC-volatility stratification has no independent volatility proxy available in this frozen dataset (the precondition study fetched it live and did not persist it), so it is reported as not-applicable, not fabricated.',
  };

  const analysisResult = {
    ...analysisResultCore,
    analysisResultHash: contentHash(analysisResultCore),
    analyzedAtUtc: new Date().toISOString(),
  };

  const outDir = path.join(RESULTS_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'analysis_result.json'), JSON.stringify(analysisResult, null, 2));

  return analysisResult;
}

module.exports = { runResearchAnalysis, analysisCodeFingerprint };
