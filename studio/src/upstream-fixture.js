/**
 * Fixture entry for the upstream-compatibility suite.
 *
 * Loads the unmodified AOS build plus the opt-in scrub layer, exactly the way a
 * host page would. Kept separate from the studio bundle so window-scroll
 * behaviour can be tested without the studio's `overflow: hidden` shell.
 */
import AOS from '@aos';

window.__AOS__ = AOS;

AOS.init({
  duration: 300,
  once: false,
  disableMutationObserver: false,
  scrub: true
});
