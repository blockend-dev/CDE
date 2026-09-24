'use strict';
/**
 * Plain Node http server — no Express, no new dependencies, mirroring the
 * zero-dependency posture of cde/lib. This is the ONLY trusted boundary
 * between the browser and the frozen research artifacts: the browser
 * never touches the filesystem directly, and every handler here either
 * reads frozen data or calls an existing, already-tested CDE function.
 * Run: node demo/server/httpServer.js  (defaults to http://localhost:5175)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dataLoader = require('./dataLoader');
const integrity = require('./integrity');
const orderSensitivity = require('./orderSensitivity');
const tamper = require('./tamper');
const provenance = require('./provenance');
const baseline = require('./baseline');
const timeline = require('./timeline');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GIT_SHELL = process.platform === 'win32' ? 'bash.exe' : undefined;

/**
 * Some hosts (Render confirmed) shallow-clone (`git fetch --depth=1`) by
 * default, which breaks any `git log -- <path>` historical query — both
 * cde/phase5/preflight.js's integrity checks and this demo's Timeline screen
 * rely on real commit history. Converting to a full clone once at boot fixes
 * this at the root instead of only working around it. If it can't (no
 * remote reachable, outbound network blocked, etc.), nothing here depends on
 * it succeeding: demo/server/integrity.js still falls back to an independent
 * content hash (lockedMetricsHash.json) and demo/server/timeline.js reads
 * recorded commit data (timelineCommits.json) rather than a live git query.
 * See REPRODUCIBILITY.md.
 */
function unshallowIfNeeded() {
  try {
    const isShallow = execSync('git rev-parse --is-shallow-repository', { cwd: REPO_ROOT, shell: GIT_SHELL }).toString().trim() === 'true';
    if (!isShallow) return;
    console.log('Shallow git checkout detected — fetching full history...');
    execSync('git fetch --unshallow', { cwd: REPO_ROOT, shell: GIT_SHELL, stdio: 'pipe', timeout: 20000 });
    console.log('Full git history fetched.');
  } catch (err) {
    console.log(`Could not fetch full git history at boot — continuing on recorded-data fallbacks: ${err.message}`);
  }
}

const WEB_ROOT = path.join(__dirname, '..', 'web');
// PORT is what most hosting platforms inject automatically; DEMO_PORT is this project's own
// override for local use. Either works; DEMO_PORT wins if both happen to be set.
const PORT = Number(process.env.DEMO_PORT || process.env.PORT || 5175);

// The two browser libraries come from npm, not a CDN. Only these two
// directories of node_modules are exposed, read-only, and only .js files —
// the import map in web/index.html points "three" and "animejs" here.
const NODE_MODULES = path.join(__dirname, '..', '..', 'node_modules');
const VENDOR_ROOTS = {
  '/vendor/three/': path.join(NODE_MODULES, 'three', 'build'),
  '/vendor/animejs/': path.join(NODE_MODULES, 'animejs', 'dist', 'modules'),
};

function within(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

const routes = []; // { method, pattern: RegExp, paramNames, handler }

function route(method, pattern, handler) {
  const paramNames = [];
  const regexSource = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${regexSource}$`), paramNames, handler });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, status, message, extra) {
  sendJson(res, status, { error: message, ...(extra || {}) });
}

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function serveVendor(req, res, pathname) {
  const prefix = Object.keys(VENDOR_ROOTS).find((p) => pathname.startsWith(p));
  if (!prefix) return false;
  const root = VENDOR_ROOTS[prefix];
  const filePath = path.resolve(root, pathname.slice(prefix.length));
  if (!within(root, filePath) || path.extname(filePath) !== '.js') {
    sendError(res, 403, 'forbidden');
    return true;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  });
  return true;
}

function serveStatic(req, res, pathname) {
  if (serveVendor(req, res, pathname)) return;
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(WEB_ROOT, relPath);
  if (!within(WEB_ROOT, filePath)) return sendError(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback for hash-routed screens with no matching file
      if (path.extname(relPath) === '') {
        return fs.readFile(path.join(WEB_ROOT, 'index.html'), (err2, data2) => {
          if (err2) return sendError(res, 404, 'not found');
          res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] });
          res.end(data2);
        });
      }
      return sendError(res, 404, 'not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

route('GET', '/api/experiment', (req, res) => {
  sendJson(res, 200, dataLoader.experimentSummary());
});

route('GET', '/api/pairs', (req, res, params, query) => {
  const pairs = dataLoader.listPairs(query).map((p) => ({
    pairingKey: p.pairingKey,
    condition: p.condition,
    symbol: p.symbol,
    marketTimestampUtc: p.marketTimestampUtc,
    claimTemplate: p.claimTemplate,
    exposureDelta: p.exposureDelta,
    confidenceDelta: p.confidenceDelta,
    directionFlip: p.directionFlip,
    claimStatusChanged: p.claimStatusChanged,
    structuredDecisionChanged: p.structuredDecisionChanged,
    injectedClaimAssessment: p.injectedClaimAssessment,
    injectedDirection: p.injectedDirection,
  }));
  sendJson(res, 200, { count: pairs.length, pairs });
});

route('GET', '/api/pairs/:pairingKey', (req, res, params) => {
  const pair = dataLoader.getPair(params.pairingKey);
  if (!pair) return sendError(res, 404, 'pair not found');
  sendJson(res, 200, pair);
});

route('GET', '/api/pairs/:pairingKey/provenance', (req, res, params) => {
  try {
    sendJson(res, 200, provenance.provenanceFor(params.pairingKey));
  } catch (err) {
    sendError(res, 404, err.message);
  }
});

route('GET', '/api/pairs/:pairingKey/baseline', (req, res, params) => {
  try {
    sendJson(res, 200, baseline.baselineFor(params.pairingKey));
  } catch (err) {
    sendError(res, 404, err.message);
  }
});

route('GET', '/api/timeline', (req, res) => {
  sendJson(res, 200, { timeline: timeline.buildTimeline() });
});

route('GET', '/api/integrity/identity', (req, res) => {
  sendJson(res, 200, { identity: integrity.experimentIdentity() });
});

route('POST', '/api/integrity/verify', (req, res) => {
  // Synchronous by design: this actually re-executes the locked analysis
  // and every preflight check (~seconds), it does not simulate a delay.
  const result = integrity.verifyExperiment();
  sendJson(res, 200, result);
});

route('GET', '/api/reproducibility/order-sensitivity', (req, res) => {
  // Real computation (the locked analysis, re-run in memory under several input orders); cached after the first call.
  sendJson(res, 200, orderSensitivity.orderSensitivity());
});

route('GET', '/api/tamper/scenarios', (req, res) => {
  sendJson(res, 200, { scenarios: tamper.listScenarios() });
});

route('POST', '/api/tamper/:scenario', (req, res, params) => {
  try {
    const result = tamper.runTamperScenario(params.scenario);
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
});

function handle(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(parsed.pathname);
  const query = Object.fromEntries(parsed.searchParams.entries());

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = m[i + 1]));
      try {
        return r.handler(req, res, params, query);
      } catch (err) {
        return sendError(res, 500, err.message, { stack: (err.stack || '').split('\n').slice(0, 5) });
      }
    }
    return sendError(res, 404, `no API route for ${req.method} ${pathname}`);
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  return sendError(res, 405, 'method not allowed');
}

function start(port = PORT) {
  unshallowIfNeeded();
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`CDE demo server listening on http://localhost:${port}`);
    console.log(`Serving frozen run: ${dataLoader.RUN_ID}`);
  });
  return server;
}

module.exports = { start, handle, route };

if (require.main === module) start();
