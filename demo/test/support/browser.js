'use strict';
/**
 * Minimal real-browser driver over the Chrome DevTools Protocol — no
 * dependencies (Node's built-in WebSocket + whatever Chrome/Edge is
 * installed). Used by demo/test/m13.browser.test.js. Everything here is
 * optional: if no browser (or no global WebSocket) is available, callers
 * skip instead of failing.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function available() {
  return typeof WebSocket !== 'undefined' && !!findBrowser();
}

/** @param {{webgl?: boolean}} [opts] webgl:false starts the browser with WebGL disabled (to exercise the fallback). */
async function launch({ webgl = true } = {}) {
  const exe = findBrowser();
  if (!exe || typeof WebSocket === 'undefined') throw new Error('no browser available');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-browser-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0', // the browser picks a free port and reports it in DevToolsActivePort
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1440,900',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
  if (webgl) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl');
  else args.push('--disable-gpu', '--disable-webgl', '--disable-3d-apis');
  args.push('about:blank');
  const proc = spawn(exe, args, { stdio: 'ignore' });

  let port = null;
  for (let i = 0; i < 80 && !port; i++) {
    try {
      port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch (_) {
      await sleep(250);
    }
  }
  if (!port) { try { proc.kill(); } catch (_) {} throw new Error('browser did not expose a debugging port'); }

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (_) {}
    if (!target) await sleep(250);
  }
  if (!target) { try { proc.kill(); } catch (_) {} throw new Error('no page target'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push({ type: 'exception', text: (d.exception && (d.exception.description || d.exception.value)) || d.text });
    } else if (msg.method === 'Log.entryAdded') {
      logs.push({ type: `log-${msg.params.entry.level}`, text: `${msg.params.entry.text} ${msg.params.entry.url || ''}` });
    }
  };
  // Every call has a deadline, and a closed connection fails everything still waiting: a lost reply must
  // turn into a clear test failure, never an endless await.
  let closed = false;
  ws.onclose = () => {
    closed = true;
    for (const { rej } of pending.values()) rej(new Error('browser connection closed'));
    pending.clear();
  };
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((res, rej) => {
      if (closed) return rej(new Error('browser connection closed'));
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); rej(new Error(`no reply from browser to ${method} within ${timeoutMs}ms`)); }, timeoutMs);
      pending.set(i, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

  const api = {
    send,
    logs,
    /** console errors and uncaught exceptions only */
    errors: () => logs.filter((l) => ['exception', 'error', 'log-error'].includes(l.type)),
    sleep,
    viewport: (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }),
    reducedMotion: (on) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] }),
    async goto(url, settleMs = 400) { await send('Page.navigate', { url }); await sleep(settleMs); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    },
    async waitFor(expression, timeoutMs = 20000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try { if (await api.eval(expression)) return true; } catch (_) {}
        await sleep(200);
      }
      return false;
    },
    clickText: (selector, text) => api.eval(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!e) return false; e.click(); return true; })()`),
    click: (selector) => api.eval(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return false; e.click(); return true; })()`),
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try { await send('Browser.close'); } catch (_) {}
      try { ws.close(); } catch (_) {}
      try { proc.kill(); } catch (_) {}
      await sleep(400);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    },
  };
  return api;
}

module.exports = { launch, available, findBrowser, sleep };
