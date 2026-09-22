import { describe, it, expect } from 'vitest'
import { buildThemeCss, contrastOn, isDefaultTheme, mix, relLuminance, resolveDeckTheme, DEFAULT_THEME } from './theme'
import type { CourseTheme } from './types'

describe('isDefaultTheme / resolveDeckTheme', () => {
  const getBlob = async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

  it('absent and default-equivalent themes resolve to undefined (byte-stable output)', async () => {
    expect(isDefaultTheme(null)).toBe(true)
    expect(isDefaultTheme(undefined)).toBe(true)
    expect(isDefaultTheme({ ...DEFAULT_THEME })).toBe(true)
    expect(isDefaultTheme({ ...DEFAULT_THEME, primary: '#3194a0' })).toBe(true) // case-insensitive
    expect(await resolveDeckTheme(null, getBlob)).toBeUndefined()
    expect(await resolveDeckTheme({ ...DEFAULT_THEME }, getBlob)).toBeUndefined()
  })

  it('a custom theme resolves with validated fields', async () => {
    const t: CourseTheme = { scheme: 'light', primary: '#aa1122', font: 'serif' }
    expect(await resolveDeckTheme(t, getBlob)).toEqual({ scheme: 'light', primary: '#aa1122', font: 'serif' })
  })

  it('the logo blob becomes a data URI', async () => {
    const t: CourseTheme = {
      scheme: 'dark', primary: '#aa1122', font: 'sans',
      logo: { mediaId: 'm1', name: 'logo.png', size: 4, type: 'image/png' },
    }
    const out = await resolveDeckTheme(t, getBlob)
    expect(out!.logoDataUri).toMatch(/^data:image\/png;base64,/)
  })

  it('an invalid stored primary falls back to the default accent', async () => {
    const t = { scheme: 'dark', primary: 'red', font: 'sans' } as CourseTheme
    expect((await resolveDeckTheme(t, getBlob))!.primary).toBe(DEFAULT_THEME.primary)
  })
})

describe('buildThemeCss', () => {
  it('no theme → empty string', () => {
    expect(buildThemeCss(null)).toBe('')
    expect(buildThemeCss(undefined)).toBe('')
  })

  it('dark theme overrides accent vars only', () => {
    const css = buildThemeCss({ scheme: 'dark', primary: '#aa1122', font: 'sans' })
    expect(css).toContain('--teal:#aa1122')
    expect(css).toContain('--on-accent:')
    expect(css).not.toContain('--bg:') // dark keeps the built-in base palette
  })

  it('light scheme emits the full light base palette', () => {
    const css = buildThemeCss({ scheme: 'light', primary: '#aa1122', font: 'serif' })
    expect(css).toContain('--bg:#f4f6f8')
    expect(css).toContain('--text:#17222c')
    expect(css).toContain('Georgia')
  })

  it('a high-luminance primary is darkened for text roles on light (yellow-on-white)', () => {
    const css = buildThemeCss({ scheme: 'light', primary: '#ffe14d', font: 'sans' })
    const teal = css.match(/--teal:(#[0-9a-f]{6})/)![1]
    expect(teal).not.toBe('#ffe14d')
    expect(relLuminance(teal)).toBeLessThan(relLuminance('#ffe14d'))
  })
})

describe('color math', () => {
  it('mix blends linearly', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#ff0000', '#ff0000', 0.3)).toBe('#ff0000')
  })

  it('contrastOn picks dark text on light accents, light text on dark accents', () => {
    expect(contrastOn('#ffe14d')).toBe('#04222a')
    expect(contrastOn('#1a2b3c')).toBe('#f4fafc')
  })
})
