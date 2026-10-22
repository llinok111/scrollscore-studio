/**
 * ScrollScore Studio — application store
 *
 * Holds the project document, the current selection, and the live scroll
 * progress. Every mutation goes through `commit()` so undo/redo stays
 * consistent; continuous gestures (keyframe drags) use begin/end transactions
 * so one drag produces exactly one history entry.
 */
import {
  createLayer,
  normalizeProject,
  MOTION_PRESETS,
  normalizeKeys,
  PROPS
} from '@scrub/index.js';

const deepClone = (value) =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

export function createStore(initialProject) {
  let project = normalizeProject(initialProject);
  let selectedId = project.layers[0] ? project.layers[0].id : null;
  let progress = 0;
  let activeProp = null;
  let dirty = false;

  const listeners = new Set();
  const past = [];
  const future = [];
  const HISTORY_LIMIT = 80;
  let pendingSnapshot = null;

  const snapshot = () => JSON.stringify(project);

  function emit(reason) {
    for (const fn of listeners) fn(api, reason);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function pushHistory(serialized) {
    past.push(serialized);
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }

  function getLayer(id) {
    return project.layers.find((l) => l.id === (id || selectedId)) || null;
  }

  function commit(mutator, reason = 'commit') {
    const before = snapshot();
    const result = mutator(project);
    if (result !== undefined) project = normalizeProject(result);
    if (snapshot() === before) return false;
    pushHistory(before);
    emit(reason);
    return true;
  }

  /** Start a continuous gesture; the first commit inside it is not recorded. */
  function beginTransaction() {
    if (pendingSnapshot === null) pendingSnapshot = snapshot();
  }

  function endTransaction(reason = 'commit') {
    if (pendingSnapshot === null) return;
    const before = pendingSnapshot;
    pendingSnapshot = null;
    if (snapshot() !== before) {
      pushHistory(before);
      emit(reason);
    }
  }

  /** Mutate without recording history (only valid inside a transaction). */
  function update(mutator, reason = 'update') {
    const result = mutator(project);
    if (result !== undefined) project = normalizeProject(result);
    emit(reason);
  }

  function undo() {
    if (past.length === 0) return false;
    future.push(snapshot());
    project = JSON.parse(past.pop());
    ensureSelection();
    emit('undo');
    return true;
  }

  function redo() {
    if (future.length === 0) return false;
    past.push(snapshot());
    project = JSON.parse(future.pop());
    ensureSelection();
    emit('redo');
    return true;
  }

  function ensureSelection() {
    if (!project.layers.some((l) => l.id === selectedId)) {
      selectedId = project.layers[0] ? project.layers[0].id : null;
    }
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    activeProp = null;
    emit('select');
  }

  function setActiveProp(prop) {
    if (activeProp === prop) return;
    activeProp = prop;
    emit('active-prop');
  }

  function setProgress(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    if (Math.abs(next - progress) < 0.00005) return;
    progress = next;
    emit('progress');
  }

  function addLayer(partial) {
    const layer = createLayer(partial);
    commit((p) => {
      p.layers.push(layer);
    }, 'add-layer');
    select(layer.id);
    return layer;
  }

  function removeLayer(id) {
    const index = project.layers.findIndex((l) => l.id === id);
    if (index < 0) return;
    commit((p) => {
      p.layers.splice(index, 1);
    }, 'remove-layer');
    ensureSelection();
  }

  function patchLayer(id, patch, reason = 'patch') {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === id);
      if (!layer) return;
      Object.assign(layer, patch);
    }, reason);
  }

  function patchStyle(id, patch, reason = 'patch-style') {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === id);
      if (!layer) return;
      Object.assign(layer.style, patch);
    }, reason);
  }

  function patchMotion(id, patch, reason = 'patch-motion') {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === id);
      if (!layer) return;
      Object.assign(layer.motion, patch);
    }, reason);
  }

  function applyPreset(id, presetName) {
    const preset = MOTION_PRESETS[presetName];
    if (!preset) return;
    const built = preset.build();
    commit((p) => {
      const layer = p.layers.find((l) => l.id === id);
      if (!layer) return;
      layer.motion = {
        ...layer.motion,
        ...built,
        tracks: built.tracks ? deepClone(built.tracks) : layer.motion.tracks
      };
    }, 'apply-preset');
  }

  /**
   * Add a keyframe at the current progress for a property. If the property has
   * no track yet, a sensible two-key track is seeded from its resting value.
   */
  function addKeyframe(layerId, prop, atProgress = progress) {
    const def = PROPS[prop];
    if (!def) return;
    commit((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const tracks = layer.motion.tracks;
      if (!tracks[prop]) {
        tracks[prop] = normalizeKeys([
          { p: 0, v: def.base },
          { p: 1, v: def.base }
        ]);
      }
      const keys = tracks[prop].filter((k) => Math.abs(k.p - atProgress) > 0.004);
      keys.push({ p: atProgress, v: currentValue(tracks[prop], atProgress) });
      tracks[prop] = normalizeKeys(keys);
    }, 'add-key');
  }

  function currentValue(keys, t) {
    if (!keys || keys.length === 0) return 0;
    if (t <= keys[0].p) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.p) return last.v;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t >= a.p && t <= b.p) {
        const span = b.p - a.p || 1;
        return a.v + (b.v - a.v) * ((t - a.p) / span);
      }
    }
    return last.v;
  }

  function moveKeyframe(layerId, prop, index, nextProgress) {
    const layer = getLayer(layerId);
    if (!layer) return;
    const keys = layer.motion.tracks[prop];
    if (!keys || !keys[index]) return;
    // Deliberately unsorted while dragging: sorting mid-gesture would swap the
    // node under the pointer. `normalizeTrack()` re-sorts on pointer-up.
    keys[index] = { ...keys[index], p: Math.max(0, Math.min(1, nextProgress)) };
    emit('move-key');
  }

  function normalizeTrack(layerId, prop) {
    const layer = getLayer(layerId);
    if (!layer || !layer.motion.tracks[prop]) return;
    layer.motion.tracks[prop] = normalizeKeys(layer.motion.tracks[prop]);
    emit('normalize-track');
  }

  function setKeyframeValue(layerId, prop, index, value) {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const keys = layer.motion.tracks[prop];
      if (!keys || !keys[index]) return;
      keys[index] = { ...keys[index], v: Number(value) };
    }, 'key-value');
  }

  function removeKeyframe(layerId, prop, index) {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const keys = layer.motion.tracks[prop];
      if (!keys) return;
      const next = keys.filter((_, i) => i !== index);
      if (next.length === 0) delete layer.motion.tracks[prop];
      else layer.motion.tracks[prop] = next;
    }, 'remove-key');
  }

  function removeTrack(layerId, prop) {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer) return;
      delete layer.motion.tracks[prop];
    }, 'remove-track');
  }

  function clearTracks(layerId) {
    commit((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.motion.tracks = {};
    }, 'clear-tracks');
  }

  function replaceProject(next, reason = 'replace') {
    commit(() => normalizeProject(next), reason);
    ensureSelection();
  }

  function loadProject(next) {
    project = normalizeProject(next);
    selectedId = project.layers[0] ? project.layers[0].id : null;
    progress = 0;
    past.length = 0;
    future.length = 0;
    emit('load');
  }

  const api = {
    subscribe,
    get project() {
      return project;
    },
    get selectedId() {
      return selectedId;
    },
    get selected() {
      return getLayer();
    },
    get progress() {
      return progress;
    },
    get activeProp() {
      return activeProp;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get dirty() {
      return dirty;
    },
    markClean() {
      dirty = false;
      emit('clean');
    },
    commit,
    update,
    beginTransaction,
    endTransaction,
    undo,
    redo,
    select,
    setActiveProp,
    setProgress,
    addLayer,
    removeLayer,
    patchLayer,
    patchStyle,
    patchMotion,
    applyPreset,
    addKeyframe,
    moveKeyframe,
    normalizeTrack,
    setKeyframeValue,
    removeKeyframe,
    removeTrack,
    clearTracks,
    replaceProject,
    loadProject,
    getLayer,
    currentValue
  };

  return api;
}
