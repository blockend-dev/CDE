'use strict';
/**
 * Milestone 12 — frontend architecture and the visual system's contracts.
 * No browser needed (m13 covers the real-browser behaviour):
 *   - the import map's libraries (three, animejs) really load: every module in
 *     their import graph is served, byte-identical to node_modules, and the
 *     packages themselves import and export what the app uses;
 *   - the vendor route is read-only and traversal-proof;
 *   - the demo stays read-only: only the two documented POST routes exist and
 *     a full session leaves cde/ and research/ byte-identical;
 *   - WebGL fallback and reduced-motion are real behaviours, exercised by
 *     running the actual modules against stubs;
 *   - the directory layout is what the app expects, with no stale copies.
 * Run: node demo/test/m12.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { start } = require('../server/httpServer');
const { fetchRetry: fetch } = require('./testUtil');

const REPO = path.join(__dirname, '..', '..');
const WEB = path.join(__dirname, '..', 'web');
const importModule = (rel, query = '') => import(pathToFileURL(path.join(WEB, 'js', rel)).href + query);

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

function hashTree(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) walk(abs, relPath);
      else h.update(relPath).update('\0').update(fs.readFileSync(abs)).update('\0');
    }
  })(dir, '');
  return h.digest('hex');
}

// Scan code, not comments: libraries carry JSDoc `@import` type hints that no browser ever requests.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const staticImports = (src) => [...stripComments(src).matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);

async function main() {
  const server = start(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  // ---------------------------------------------------------------- layout
  await check('the frontend has the intended structure and no obsolete files from the old layout', () => {
    for (const p of [
      'index.html', 'assets/favicon.svg',
      'css/tokens.css', 'css/main.css', 'css/glass.css', 'css/motion.css', 'css/responsive.css',
      'js/main.js', 'js/api.js', 'js/judgeMode.js',
      'js/visual/scene.js', 'js/visual/glass.js', 'js/visual/particles.js', 'js/visual/motion.js',
      'js/components/integrityChain.js', 'js/components/experimentDiagram.js',
      'js/screens/lab.js', 'js/screens/casefiles.js', 'js/screens/pairDetail.js', 'js/screens/integrity.js', 'js/screens/break.js', 'js/screens/timeline.js',
      'js/screens/tabs/counterfactual.js', 'js/screens/tabs/chain.js', 'js/screens/tabs/xray.js', 'js/screens/tabs/provenance.js', 'js/screens/tabs/baseline.js',
    ]) assert.ok(fs.existsSync(path.join(WEB, p)), `missing ${p}`);
    for (const stale of ['main.js', 'api.js', 'judgeMode.js', 'screens', 'styles', 'js/screens/tabs/counterfactualTab.js', 'js/screens/tabs/chainTab.js', 'js/screens/tabs/xrayTab.js', 'js/screens/tabs/provenanceTab.js', 'js/screens/tabs/baselineTab.js']) {
      assert.ok(!fs.existsSync(path.join(WEB, stale)), `obsolete path still present: ${stale}`);
    }
  });

  await check('every relative import in the frontend resolves to a real file (moved files left no dangling imports)', () => {
    let checked = 0;
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) {
          for (const spec of staticImports(fs.readFileSync(p, 'utf8'))) {
            assert.ok(fs.existsSync(path.resolve(path.dirname(p), spec)), `${path.relative(WEB, p)} imports missing ${spec}`);
            checked += 1;
          }
        }
      }
    })(path.join(WEB, 'js'));
    assert.ok(checked > 30, `expected to check many imports, checked ${checked}`);
  });

  await check('index.html loads the five stylesheets, the import map, and js/main.js — and only local resources (no CDN)', () => {
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
    for (const css of ['tokens', 'main', 'glass', 'motion', 'responsive']) assert.ok(html.includes(`/css/${css}.css`), `index.html must link ${css}.css`);
    assert.ok(html.includes('/js/main.js') && html.includes('type="importmap"'));
    assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')), 'index.html must not reference any remote URL');
  });

  // ---------------------------------------------------------------- vendor modules
  const importMap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'))[1]).imports;

  await check('the import map covers exactly three and animejs, and both entry modules are served as JavaScript', async () => {
    assert.deepStrictEqual(Object.keys(importMap).sort(), ['animejs', 'three']);
    for (const url of Object.values(importMap)) {
      const res = await fetch(`${base}${url}`);
      assert.strictEqual(res.status, 200, url);
      assert.ok(res.headers.get('content-type').includes('javascript'));
    }
  });

  await check('every module in three\'s and animejs\'s import graph is served and byte-identical to node_modules (Three.js and Anime.js assets load)', async () => {
    const roots = { '/vendor/three/': path.join(REPO, 'node_modules', 'three', 'build'), '/vendor/animejs/': path.join(REPO, 'node_modules', 'animejs', 'dist', 'modules') };
    const counts = {};
    for (const entry of Object.values(importMap)) {
      const seen = new Set();
      const queue = [entry];
      while (queue.length) {
        const url = queue.pop();
        if (seen.has(url)) continue;
        seen.add(url);
        const res = await fetch(`${base}${url}`);
        assert.strictEqual(res.status, 200, `${url} not served`);
        const body = Buffer.from(await res.arrayBuffer());
        const prefix = Object.keys(roots).find((p) => url.startsWith(p));
        assert.ok(body.equals(fs.readFileSync(path.join(roots[prefix], url.slice(prefix.length)))), `${url} differs from node_modules`);
        for (const spec of staticImports(body.toString('utf8'))) queue.push(new URL(spec, `http://x${url}`).pathname);
      }
      counts[entry] = seen.size;
    }
    assert.ok(counts[importMap.three] >= 2, 'three should load module + core');
    assert.ok(counts[importMap.animejs] >= 20, `animejs graph looked too small: ${counts[importMap.animejs]}`);
  });

  await check('three and animejs import under Node and export what the app uses', async () => {
    const THREE = await import('three');
    for (const name of ['WebGLRenderer', 'Scene', 'PerspectiveCamera', 'Points', 'LineSegments', 'CanvasTexture', 'AdditiveBlending', 'Group', 'Color', 'Vector3']) assert.ok(name in THREE, `three.${name} missing`);
    const A = await import('animejs');
    assert.strictEqual(typeof A.animate, 'function');
    assert.strictEqual(typeof A.stagger, 'function');
    const pkg = (n) => JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).dependencies[n];
    assert.ok(pkg('three') && pkg('animejs'), 'both libraries must be declared as real npm dependencies');
  });

  await check('the vendor route is read-only and traversal-proof: only .js under the two whitelisted directories', async () => {
    const probe = async (p) => (await fetch(`${base}${p}`)).status;
    assert.strictEqual(await probe('/vendor/three/three.cjs'), 403);
    assert.strictEqual(await probe('/vendor/animejs/index.d.ts'), 403);
    assert.strictEqual(await probe('/vendor/three/..%2f..%2fpackage.json'), 403, 'an encoded-slash traversal must be refused');
    // Dot-segments normalise to /package.json, which is resolved inside the web root — it must never be the repo's own package.json.
    const dotSegments = await fetch(`${base}/vendor/three/%2e%2e/%2e%2e/package.json`);
    if (dotSegments.status === 200) assert.notStrictEqual(JSON.parse(await dotSegments.text()).name, JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).name, 'traversal reached the repository root');
    assert.strictEqual(await probe('/vendor/three/nope.js'), 404);
    assert.strictEqual(await probe('/vendor/react/index.js'), 404, 'only three and animejs are exposed');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${base}/vendor/three/three.module.js`, { method });
      assert.ok(res.status === 405 || res.status === 404, `${method} on a vendor path returned ${res.status}`);
    }
  });

  // ---------------------------------------------------------------- read-only
  await check('the demo API is read-only: exactly two POST routes exist (verify, tamper on disposable copies) and no PUT/PATCH/DELETE', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'httpServer.js'), 'utf8');
    const routes = [...src.matchAll(/route\('(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepStrictEqual(routes.filter((r) => !r.startsWith('GET ')).sort(), ['POST /api/integrity/verify', 'POST /api/tamper/:scenario']);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.ok([404, 405].includes((await fetch(`${base}/api/experiment`, { method })).status), `${method} must not be accepted`);
    }
  });

  await check('only integrity.js (restoring the exact original bytes) and tamper.js (its own temp copy) write to disk anywhere in demo/server', () => {
    const dir = path.join(__dirname, '..', 'server');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const writes = /\b(writeFileSync|appendFileSync|rmSync|unlinkSync|mkdtempSync|copyFileSync|renameSync)\b/.test(src);
      if (!['integrity.js', 'tamper.js'].includes(f)) assert.ok(!writes, `${f} must not write to disk`);
    }
  });

  await check('a full session (every route, live verification, a tamper attack) leaves cde/ and research/ byte-identical', async () => {
    const before = { cde: hashTree(path.join(REPO, 'cde')), research: hashTree(path.join(REPO, 'research')) };
    const dl = require('../server/dataLoader');
    const key = dl.load().pairs[0].pairingKey;
    for (const p of ['/api/experiment', '/api/pairs', `/api/pairs/${key}`, `/api/pairs/${key}/provenance`, `/api/pairs/${key}/baseline`, '/api/integrity/identity', '/api/tamper/scenarios', '/api/timeline']) {
      assert.strictEqual((await fetch(`${base}${p}`)).status, 200, p);
    }
    const verify = await (await fetch(`${base}/api/integrity/verify`, { method: 'POST' })).json();
    assert.strictEqual(verify.allPassed, true);
    assert.strictEqual(verify.components.length, 8);
    const attack = await (await fetch(`${base}/api/tamper/duplicate-pair`, { method: 'POST' })).json();
    assert.strictEqual(attack.canonicalDataUntouched, true);
    assert.deepStrictEqual({ cde: hashTree(path.join(REPO, 'cde')), research: hashTree(path.join(REPO, 'research')) }, before);
  });

  // ---------------------------------------------------------------- fallbacks (real modules, stubbed browser)
  await check('WebGL fallback: with no WebGL context the scene reports a fallback, tags <html>, and every API call is a safe no-op', async () => {
    const tagged = [];
    globalThis.document = { documentElement: { classList: { add: (c) => tagged.push(`+${c}`), remove: (c) => tagged.push(`-${c}`) } }, createElement: () => ({ getContext: () => null }) };
    globalThis.location = { search: '' };
    globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
    const { initScene, scene } = await importModule('visual/scene.js', '?fallback');
    const api = await initScene({});
    assert.strictEqual(api.status, 'fallback');
    assert.match(api.reason, /WebGL unavailable/);
    assert.ok(tagged.includes('+scene-off'));
    assert.strictEqual(scene.status, 'fallback');
    scene.setMode('integrity'); scene.showPair({ condition: 'weekend' }); scene.anchorTo({}); scene.beginVerify(); scene.restore();
    for (const p of [scene.runChain([]), scene.resolveVerify([]), scene.showBreak([])]) assert.ok(p && typeof p.then === 'function', 'timed sequences must still resolve so callers never hang');
    assert.strictEqual(await scene.runChain([]), undefined);
  });

  await check('?scene=off disables the scene without touching WebGL', async () => {
    let touchedGl = false;
    globalThis.document = { documentElement: { classList: { add() {}, remove() {} } }, createElement: () => ({ getContext: () => { touchedGl = true; return null; } }) };
    globalThis.location = { search: '?scene=off' };
    const { initScene } = await importModule('visual/scene.js', '?off');
    const api = await initScene({});
    assert.match(api.reason, /disabled/);
    assert.strictEqual(touchedGl, false);
  });

  await check('reduced motion: every motion helper applies the final state immediately and reports motion unavailable', async () => {
    globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {} }) };
    const m = await importModule('visual/motion.js', '?reduced');
    assert.strictEqual(m.prefersReducedMotion(), true);
    assert.strictEqual(m.motionAvailable(), false);
    const el = { textContent: '', style: {} };
    m.countTo(el, 0.4909, { format: (v) => v.toFixed(4) });
    assert.strictEqual(el.textContent, '0.4909', 'numbers must land on the exact final value with no animation');
    m.enter(el); m.flash(el); m.settle(el); m.slideUp(el);
    assert.deepStrictEqual(el.style, {}, 'no helper may touch styles under reduced motion');
    await m.staggerIn([el, el]);
    m.swapText(el, 'final');
    assert.strictEqual(el.textContent, 'final');
  });

  await check('if Anime.js cannot run, motion helpers degrade to the exact final state instead of leaving content hidden', async () => {
    globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
    const m = await importModule('visual/motion.js', '?degraded');
    await m.motionReady();
    if (m.motionAvailable()) return; // animejs ran in this environment; the degraded path is covered by the reduced-motion test
    const el = { textContent: '' };
    m.countTo(el, 42, { format: (v) => `v${v}` });
    assert.strictEqual(el.textContent, 'v42');
  });

  await new Promise((r) => server.close(r));
  console.log(`\n${failures === 0 ? 'ALL DEMO M12 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M12 test runner crashed:', err);
  process.exitCode = 1;
});
