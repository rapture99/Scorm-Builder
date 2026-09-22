import type { CourseTheme, DeckTheme, MediaRef } from './types'

/**
 * Player theming. The template's palette is all CSS custom properties on
 * :root; buildThemeCss generates an override block injected into
 * <style id="theme"> at build time. No theme (or a default-equivalent one)
 * yields an empty string — the exported player is byte-identical to before.
 * The logo ships as a data URI inside the deck JSON so preview (blob-URL
 * iframe), export and batch all render it with zero path plumbing.
 */

export const DEFAULT_THEME: CourseTheme = { scheme: 'dark', primary: '#3194A0', font: 'sans' }

export const HEX_RE = /^#[0-9a-f]{6}$/i

/** Keep data-URI logos sane — they are embedded into every package's index.html. */
export const LOGO_WARN_BYTES = 200 * 1024

const FONT_STACKS: Record<CourseTheme['font'], string> = {
  // system stacks only — the player must stay self-contained (no font fetches)
  sans: 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  serif: 'Georgia,"Times New Roman",Cambria,Times,serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

/** Linear blend of two #rrggbb colors; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return `#${toHex(ca.r + (cb.r - ca.r) * t)}${toHex(ca.g + (cb.g - ca.g) * t)}${toHex(ca.b + (cb.b - ca.b) * t)}`
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Text color that stays readable ON the accent (button faces, checked boxes). */
export function contrastOn(hex: string): string {
  return relLuminance(hex) > 0.45 ? '#04222a' : '#f4fafc'
}

export function isDefaultTheme(t: CourseTheme | null | undefined): boolean {
  if (!t) return true
  return (
    t.scheme === DEFAULT_THEME.scheme &&
    t.primary.toLowerCase() === DEFAULT_THEME.primary.toLowerCase() &&
    t.font === DEFAULT_THEME.font &&
    !t.logo
  )
}

// fixed light-scheme base palette — every value here overrides a :root var in the template
const LIGHT_VARS =
  '--bg:#f4f6f8;--panel:#ffffff;--panel-2:#eef2f5;--line:#d8e0e7;--line-2:#c2ced8;' +
  '--text:#17222c;--muted:#5b6b7a;--dim:#8494a3;--body-col:#33424f;--box-line:#b6c3cf;' +
  '--pdot:#c6d1da;--top-bg:rgba(246,248,250,.94);--nav-bg:rgba(246,248,250,.96);' +
  '--veil:rgba(240,244,247,.8);--lb-bg:rgba(235,240,244,.94)'

/** Generate the :root override block for a resolved theme ('' = keep the built-in look). */
export function buildThemeCss(theme: DeckTheme | null | undefined): string {
  if (!theme) return ''
  const primary = HEX_RE.test(theme.primary) ? theme.primary : DEFAULT_THEME.primary
  const light = theme.scheme === 'light'
  // the accent doubles as a TEXT color (eyebrow, Q index) — on a light page a
  // high-luminance primary (yellow-on-white is the canonical failure) gets darkened
  const accent = light && relLuminance(primary) > 0.55 ? mix(primary, '#000000', 0.35) : primary
  const vars = [
    `--teal:${accent}`,
    `--teal-br:${light ? mix(accent, '#000000', 0.15) : mix(primary, '#ffffff', 0.25)}`,
    `--on-accent:${contrastOn(accent)}`,
    `--sans:${FONT_STACKS[theme.font] ?? FONT_STACKS.sans}`,
  ]
  if (light) vars.push(LIGHT_VARS)
  return `:root{${vars.join(';')}}`
}

/**
 * Course theme → deck theme: validate fields and inline the logo blob as a
 * data URI. Returns undefined for absent/default themes so the deck JSON (and
 * the player output) stays byte-identical when theming is unused.
 */
export async function resolveDeckTheme(
  theme: CourseTheme | null | undefined,
  getBlob: (ref: MediaRef) => Promise<Blob>,
): Promise<DeckTheme | undefined> {
  if (isDefaultTheme(theme)) return undefined
  const t = theme!
  const out: DeckTheme = {
    scheme: t.scheme === 'light' ? 'light' : 'dark',
    primary: HEX_RE.test(t.primary) ? t.primary : DEFAULT_THEME.primary,
    font: t.font in FONT_STACKS ? t.font : 'sans',
  }
  if (t.logo) out.logoDataUri = await blobToDataUrl(await getBlob(t.logo))
  return out
}

/** btoa-based (works in browsers and Node tests alike — FileReader does not). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`
}
