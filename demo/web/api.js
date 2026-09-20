/**
 * Some server routes shell out to `git` synchronously over a UNC working
 * directory (cde/phase5/preflight.js's provenance check, via bash.exe —
 * the same workaround cde/phase4/runManifest.js already needed for the
 * same UNC-path limitation). That blocks the event loop briefly and can
 * occasionally drop a request under back-to-back load. One retry after a
 * short delay is a true network-level fallback, not a masked bug: the
 * server-side logic is deterministic and re-running it yields the same
 * real result.
 */
async function fetchWithRetry(url, opts, retries = 1) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return fetchWithRetry(url, opts, retries - 1);
  }
}

export async function api(pathAndQuery, opts) {
  const res = await fetchWithRetry(`/api${pathAndQuery}`, opts);
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error || `request failed (${res.status})`);
    err.body = body;
    throw err;
  }
  return body;
}

export function shortHash(h, n = 10) {
  if (!h) return '—';
  return `${h.slice(0, n)}…`;
}

export function fmtNum(n, digits = 4) {
  if (n === null || n === undefined) return '—';
  return Number(n).toFixed(digits);
}

/** Like el(), but for non-native clickable elements (a <div> acting as a button/tab) — adds keyboard focus and Enter/Space activation so they're not mouse-only. */
export function clickable(tag, attrs, children) {
  const onclick = attrs.onclick;
  const node = el(
    tag,
    {
      ...attrs,
      tabindex: attrs.tabindex ?? '0',
      role: attrs.role ?? 'button',
      onkeydown: (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onclick) {
          e.preventDefault();
          onclick(e);
        }
      },
    },
    children
  );
  return node;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
