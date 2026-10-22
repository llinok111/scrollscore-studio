/**
 * ScrollScore - public entry point
 *
 * This is the extension surface layered on top of AOS. Importing it directly
 * (without going through `aos.js`) keeps the scrub engine usable standalone,
 * e.g. inside the studio preview or in a host app that already ships AOS.
 */
export { createScrubEngine } from './engine.js';
export {
  cubicBezier,
  resolveEase,
  sampleTable,
  AOS_PRESETS,
  TRUE_PRESETS,
  EASE_NAMES
} from './easing.js';
export {
  PROPS,
  PROP_NAMES,
  normalizeKeys,
  evaluateTrack,
  composeStyles,
  twoKey,
  fmt
} from './keyframes.js';
export {
  measureElementBounds,
  elementProgress,
  pageProgress,
  mapRange,
  pinPhase,
  parseRange,
  clamp01
} from './progress.js';
export {
  SCHEMA_VERSION,
  LAYER_TYPES,
  MOTION_PRESETS,
  PRESET_NAMES,
  createLayer,
  defaultMotion,
  normalizeMotion,
  normalizeProject,
  serializeProject,
  parseProject,
  toEntries,
  uid
} from './schema.js';
export { parseTrackAttr, readScrubAttributes, collectScrubNodes } from './attributes.js';
