'use strict';
/**
 * Secret redaction. Applied to everything before it is written to a
 * serialized result, a log file, or a thrown-error's `details` — API keys
 * must never appear in cde/phase2/output/*, in provenance, or in any error
 * surfaced up to the experiment runner.
 */

// Anthropic keys look like "sk-ant-api03-...."; also redact anything under
// a key/header name that conventionally carries a credential.
const SECRET_VALUE_PATTERN = /sk-ant-[A-Za-z0-9_-]{10,}/g;
const SECRET_KEY_NAME_PATTERN = /^(api[-_]?key|authorization|x-api-key|secret|token|bearer)$/i;

function redactString(value) {
  return value.replace(SECRET_VALUE_PATTERN, '[REDACTED]');
}

/** Deep-clones `value`, replacing any secret-shaped string content or secret-named keys with "[REDACTED]". Never mutates the input. */
function redactSecrets(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_NAME_PATTERN.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** True if the given value (after JSON-stringifying if needed) contains no secret-shaped content — used directly in tests. */
function containsNoSecrets(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return !SECRET_VALUE_PATTERN.test(s);
}

module.exports = { redactString, redactSecrets, containsNoSecrets, SECRET_VALUE_PATTERN };
