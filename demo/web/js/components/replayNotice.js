import { el } from '../api.js';

export const REPLAY_MODE_LABEL = 'Replay mode — frozen research artifacts';
export const NO_OUTBOUND_LABEL = 'No outbound Bitget or LLM calls are made by this demo.';

/** The demo's standing assurance, stated as a feature: what is on screen is replayed from frozen, hash-locked files. */
export function createReplayNotice({ detail } = {}) {
  return el('div', { class: 'replay-notice', role: 'note' }, [
    el('span', { class: 'badge replay' }, REPLAY_MODE_LABEL.toUpperCase()),
    el('span', { class: 'replay-text' }, detail ? `${NO_OUTBOUND_LABEL} ${detail}` : NO_OUTBOUND_LABEL),
  ]);
}
