/**
 * ScrollScore - declarative attribute parsing
 *
 * Lets plain HTML opt into scrubbing with zero JavaScript, mirroring how
 * upstream AOS is used:
 *
 *   <section
 *     data-aos-scrub
 *     data-aos-range="0.1,0.6"
 *     data-aos-ease="ease-out-cubic"
 *     data-aos-pin="0.1,0.6"
 *     data-aos-track="opacity:0>1;y:64>0;scale:0.94>1">
 *
 * `data-aos-track` grammar:  track (";" track)*
 *                            track = prop ":" from ">" to
 * Every value is validated against the property registry, so an unknown
 * property is ignored instead of silently producing a broken transform.
 */
import { PROPS, normalizeKeys } from './keyframes.js';
import { parseRange } from './progress.js';

/**
 * Parse a `data-aos-track` string into engine tracks.
 * @param {string} raw
 * @returns {Record<string, Array<{p:number,v:number}>>}
 */
export function parseTrackAttr(raw) {
  const tracks = {};
  if (typeof raw !== 'string' || raw.trim() === '') return tracks;
  for (const chunk of raw.split(';')) {
    const part = chunk.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim();
    const range = part.slice(colon + 1);
    if (!PROPS[prop]) continue;
    const arrow = range.split('>');
    if (arrow.length !== 2) continue;
    const from = Number(arrow[0]);
    const to = Number(arrow[1]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    tracks[prop] = normalizeKeys([
      { p: 0, v: from },
      { p: 1, v: to }
    ]);
  }
  return tracks;
}

/**
 * Read every supported `data-aos-*` scrub attribute off a node.
 * @param {HTMLElement} node
 * @returns {{range:[number,number], ease:string, mode:'element'|'page', offset:number, pin:[number,number]|null, tracks:Record<string,Array<{p:number,v:number}>>}}
 */
export function readScrubAttributes(node) {
  const get = (name) => (node.getAttribute ? node.getAttribute(name) : null);
  const pinRaw = get('data-aos-pin');
  return {
    mode: get('data-aos-mode') === 'page' ? 'page' : 'element',
    range: parseRange(get('data-aos-range'), [0, 1]),
    ease: get('data-aos-ease') || 'linear',
    offset: Number(get('data-aos-offset')) || 0,
    pin: pinRaw ? parseRange(pinRaw, [0, 1]) : null,
    tracks: parseTrackAttr(get('data-aos-track'))
  };
}

/**
 * Collect every node that opted into scrubbing.
 * @param {ParentNode} [root=document]
 * @returns {HTMLElement[]}
 */
export function collectScrubNodes(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.from(root.querySelectorAll('[data-aos-scrub]'));
}
