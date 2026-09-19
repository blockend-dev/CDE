'use strict';
/**
 * Shared test-only helper. Routes that shell out to `git` synchronously
 * over this repo's UNC working directory (cde/phase5/preflight.js, via
 * the same bash.exe workaround cde/phase4/runManifest.js already needed)
 * block the event loop briefly and can occasionally drop a request when
 * several such routes run back-to-back across test files in the same
 * regression pass. One retry confirms it was a transient network drop,
 * not a real assertion failure — the underlying check is deterministic.
 */
async function fetchRetry(url, opts, retries = 2) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return fetchRetry(url, opts, retries - 1);
  }
}

module.exports = { fetchRetry };
