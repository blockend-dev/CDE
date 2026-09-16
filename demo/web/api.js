export async function api(pathAndQuery, opts) {
  const res = await fetch(`/api${pathAndQuery}`, opts);
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
