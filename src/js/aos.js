/**
 * *******************************************************
 * AOS (Animate on scroll) - wowjs alternative
 * made to animate elements on scroll in both directions
 * *******************************************************
 */
// Side-effect import: the bundle only needs the stylesheet injected, and the
// default export form is no longer understood by modern bundlers (Vite 6).
import './../sass/aos.scss';

// Modules & helpers
import throttle from 'lodash.throttle';
import debounce from 'lodash.debounce';

import observer from './libs/observer';

import detect from './helpers/detector';
import handleScroll from './helpers/handleScroll';
import prepare from './helpers/prepare';
import elements from './helpers/elements';

/**
 * -------------------------------------------------------
 * ScrollScore extension (added on top of upstream AOS)
 * -------------------------------------------------------
 * Upstream AOS is a binary trigger: an element either has `aos-animate` or it
 * does not. The modules below add a continuous, progress-driven mode that
 * coexists with the original behaviour. Nothing here is active unless the host
 * opts in via `init({ scrub: true })`, `scrubFromAttributes()` or `scrub()`.
 */
import { createScrubEngine } from './scrub/engine';
import { collectScrubNodes, readScrubAttributes } from './scrub/attributes';

/**
 * Private variables
 */
let $aosElements = [];
let initialized = false;
let scrubEngine = null;

/**
 * Default options
 */
let options = {
  offset: 120,
  delay: 0,
  easing: 'ease',
  duration: 400,
  disable: false,
  once: false,
  mirror: false,
  anchorPlacement: 'top-bottom',
  startEvent: 'DOMContentLoaded',
  animatedClassName: 'aos-animate',
  initClassName: 'aos-init',
  useClassNames: false,
  disableMutationObserver: false,
  throttleDelay: 99,
  debounceDelay: 50,
  // ScrollScore additions (all opt-in, all default to upstream behaviour)
  scrub: false,
  scrubMode: 'raf',
  respectReducedMotion: true
};

// Detect not supported browsers (<=IE9)
// http://browserhacks.com/#hack-e71d8692f65334173fee715c222cb805
const isBrowserNotSupported = () => document.all && !window.atob;

/**
 * Lazily create the scrub engine. Kept lazy so that pages which never use the
 * extension pay zero cost beyond a few hundred bytes of module code.
 */
const getEngine = function getEngine() {
  if (!scrubEngine) {
    scrubEngine = createScrubEngine({
      mode: options.scrubMode,
      respectReducedMotion: options.respectReducedMotion
    });
  }
  return scrubEngine;
};

/**
 * Register every `[data-aos-scrub]` node found in the document.
 * Safe to call repeatedly: the engine replaces entries by id.
 */
const scrubFromAttributes = function scrubFromAttributes(root) {
  const engine = getEngine();
  const nodes = collectScrubNodes(root || document);
  nodes.forEach(function(node, index) {
    const config = readScrubAttributes(node);
    engine.register({
      id: node.getAttribute('data-aos-scrub-id') || `aos-scrub-${index}`,
      node,
      mode: config.mode,
      range: config.range,
      ease: config.ease,
      offset: config.offset,
      pin: config.pin,
      tracks: config.tracks
    });
  });
  engine.measure();
  engine.tick();
  engine.start();
  return engine;
};

/**
 * Register entries from a plain config object. `target` is a CSS selector so
 * exported studio output can be pasted into any page unchanged.
 *
 *   AOS.scrub({ entries: [{ target: '#hero', tracks: { y: [...] } }] })
 */
const scrub = function scrub(config) {
  const engine = getEngine();
  const list = Array.isArray(config) ? config : (config && config.entries) || [];
  list.forEach(function(item, i) {
    if (!item || !item.target) return;
    const nodes = Array.prototype.slice.call(document.querySelectorAll(item.target));
    nodes.forEach(function(node, j) {
      engine.register({
        id: item.id ? `${item.id}__${j}` : `aos-scrub-cfg-${i}-${j}`,
        node,
        mode: item.mode,
        range: item.range,
        ease: item.ease,
        offset: item.offset,
        pin: item.pin,
        tracks: item.tracks || {}
      });
    });
  });
  engine.measure();
  engine.tick();
  engine.start();
  return engine;
};

const initializeScroll = function initializeScroll() {
  // Extend elements objects in $aosElements with their positions
  $aosElements = prepare($aosElements, options);
  // Perform scroll event, to refresh view and show/hide elements
  handleScroll($aosElements);

  /**
   * Handle scroll event to animate elements on scroll
   */
  window.addEventListener(
    'scroll',
    throttle(() => {
      handleScroll($aosElements, options.once);
    }, options.throttleDelay)
  );

  /**
   * ScrollScore: start the continuous engine when requested. The upstream
   * class-based path above keeps running untouched, so a page can mix both.
   */
  if (options.scrub) {
    scrubFromAttributes();
  }

  return $aosElements;
};

/**
 * Refresh AOS
 */
const refresh = function refresh(initialize = false) {
  // Allow refresh only when it was first initialized on startEvent
  if (initialize) initialized = true;
  if (initialized) initializeScroll();
};

/**
 * Hard refresh
 * create array with new elements and trigger refresh
 */
const refreshHard = function refreshHard() {
  $aosElements = elements();

  if (isDisabled(options.disable) || isBrowserNotSupported()) {
    return disable();
  }

  refresh();
};

/**
 * Disable AOS
 * Remove all attributes to reset applied styles
 */
const disable = function() {
  $aosElements.forEach(function(el, i) {
    el.node.removeAttribute('data-aos');
    el.node.removeAttribute('data-aos-easing');
    el.node.removeAttribute('data-aos-duration');
    el.node.removeAttribute('data-aos-delay');

    if (options.initClassName) {
      el.node.classList.remove(options.initClassName);
    }

    if (options.animatedClassName) {
      el.node.classList.remove(options.animatedClassName);
    }
  });
};

/**
 * Check if AOS should be disabled based on provided setting
 */
const isDisabled = function(optionDisable) {
  return (
    optionDisable === true ||
    (optionDisable === 'mobile' && detect.mobile()) ||
    (optionDisable === 'phone' && detect.phone()) ||
    (optionDisable === 'tablet' && detect.tablet()) ||
    (typeof optionDisable === 'function' && optionDisable() === true)
  );
};

/**
 * Initializing AOS
 * - Create options merging defaults with user defined options
 * - Set attributes on <body> as global setting - css relies on it
 * - Attach preparing elements to options.startEvent,
 *   window resize and orientation change
 * - Attach function that handle scroll and everything connected to it
 *   to window scroll event and fire once document is ready to set initial state
 */
const init = function init(settings) {
  options = Object.assign(options, settings);

  // Create initial array with elements -> to be fullfilled later with prepare()
  $aosElements = elements();

  /**
   * Disable mutation observing if not supported
   */
  if (!options.disableMutationObserver && !observer.isSupported()) {
    console.info(`
      aos: MutationObserver is not supported on this browser,
      code mutations observing has been disabled.
      You may have to call "refreshHard()" by yourself.
    `);
    options.disableMutationObserver = true;
  }

  /**
   * Observe [aos] elements
   * If something is loaded by AJAX
   * it'll refresh plugin automatically
   */
  if (!options.disableMutationObserver) {
    observer.ready('[data-aos]', refreshHard);
  }

  /**
   * Don't init plugin if option `disable` is set
   * or when browser is not supported
   */
  if (isDisabled(options.disable) || isBrowserNotSupported()) {
    return disable();
  }

  /**
   * Set global settings on body, based on options
   * so CSS can use it
   */
  document
    .querySelector('body')
    .setAttribute('data-aos-easing', options.easing);

  document
    .querySelector('body')
    .setAttribute('data-aos-duration', options.duration);

  document.querySelector('body').setAttribute('data-aos-delay', options.delay);

  /**
   * Handle initializing
   */
  if (['DOMContentLoaded', 'load'].indexOf(options.startEvent) === -1) {
    // Listen to options.startEvent and initialize AOS
    document.addEventListener(options.startEvent, function() {
      refresh(true);
    });
  } else {
    window.addEventListener('load', function() {
      refresh(true);
    });
  }

  if (
    options.startEvent === 'DOMContentLoaded' &&
    ['complete', 'interactive'].indexOf(document.readyState) > -1
  ) {
    // Initialize AOS if default startEvent was already fired
    refresh(true);
  }

  /**
   * Refresh plugin on window resize or orientation change
   */
  window.addEventListener(
    'resize',
    debounce(refresh, options.debounceDelay, true)
  );

  window.addEventListener(
    'orientationchange',
    debounce(refresh, options.debounceDelay, true)
  );

  return $aosElements;
};

/**
 * Tear down the scrub engine (added by ScrollScore).
 * Upstream `AOS` has no destroy(), so this only releases extension resources.
 */
const destroy = function destroy() {
  if (scrubEngine) {
    scrubEngine.destroy();
    scrubEngine = null;
  }
};

/**
 * Export Public API
 */

export default {
  init,
  refresh,
  refreshHard,
  // ScrollScore additions
  scrub,
  scrubFromAttributes,
  getEngine,
  destroy
};
