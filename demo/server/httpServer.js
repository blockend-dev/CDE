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

const dataLoader = require('./dataLoader');
const integrity = require('./integrity');
const tamper = require('./tamper');
const provenance = require('./provenance');
const baseline = require('./baseline');
const timeline = require('./timeline');

const WEB_ROOT = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.DEMO_PORT || 5175);

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

function serveStatic(req, res, pathname) {
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(WEB_ROOT, relPath);
  if (!filePath.startsWith(WEB_ROOT)) return sendError(res, 403, 'forbidden');
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
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`CDE demo server listening on http://localhost:${port}`);
    console.log(`Serving frozen run: ${dataLoader.RUN_ID}`);
  });
  return server;
}

module.exports = { start, handle, route };

if (require.main === module) start();
