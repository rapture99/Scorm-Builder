import template from '../player/player-template.html?raw'
import type { Deck } from './types'
import { buildThemeCss } from './theme'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Inject a deck into the player template. This is the single source of truth:
 * the editor preview and the exported index.html both come from here.
 */
export function buildPlayerHtml(deck: Deck): string {
  // "</" would terminate the inline <script type="application/json"> block early
  const json = JSON.stringify(deck).replace(/<\//g, '<\\/')
  return template
    .split('__COURSE_TITLE__').join(escapeHtml(deck.title))
    .split('__SCORM_VERSION__').join(deck.scormVersion)
    // buildThemeCss output is generated purely from validated hex/enum values;
    // '' when unthemed → the empty <style id="theme"> keeps output byte-stable
    .split('/*__THEME_CSS__*/').join(buildThemeCss(deck.theme))
    .split('__DECK_JSON__').join(json)
}
