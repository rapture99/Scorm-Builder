import { describe, it, expect } from 'vitest'
import { buildPlayerHtml } from './player'
import type { Deck } from './types'

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    title: 'Course <A> & "B"',
    passMark: 80,
    scormVersion: '1.2',
    pages: [
      {
        title: 'P1',
        bodyHtml: '<p>hello</p>',
        video: { src: 'assets/v.mp4' },
        image: null,
        quiz: { questions: [{ n: 1, q: 'Q?', o: ['a', 'b'], c: [1], t: 'MCQ' }] },
      },
    ],
    ...overrides,
  }
}

function extractDeckJson(html: string): string {
  const m = html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)
  expect(m, 'DECK json block present').not.toBeNull()
  return m![1]
}

describe('buildPlayerHtml', () => {
  it('replaces every placeholder', () => {
    const html = buildPlayerHtml(deck())
    expect(html).not.toContain('__DECK_JSON__')
    expect(html).not.toContain('__COURSE_TITLE__')
    expect(html).not.toContain('__SCORM_VERSION__')
  })

  it('wires the SCORM version into the runtime wrapper', () => {
    expect(buildPlayerHtml(deck())).toContain("(window,'1.2')")
    expect(buildPlayerHtml(deck({ scormVersion: '2004' }))).toContain("(window,'2004')")
  })

  it('HTML-escapes the title', () => {
    const html = buildPlayerHtml(deck())
    expect(html).toContain('<title>Course &lt;A&gt; &amp; &quot;B&quot;</title>')
  })

  it('round-trips the deck through the embedded JSON', () => {
    const d = deck()
    const html = buildPlayerHtml(d)
    expect(JSON.parse(extractDeckJson(html))).toEqual(d)
  })

  it('survives option text containing </script>', () => {
    const d = deck()
    d.pages[0].quiz!.questions[0].o = ['</script><script>alert(1)</script>', 'safe']
    const html = buildPlayerHtml(d)
    const json = extractDeckJson(html)
    // the raw sequence must not appear inside the JSON block (it would close the tag early)
    expect(json).not.toContain('</script>')
    const parsed = JSON.parse(json)
    expect(parsed.pages[0].quiz.questions[0].o[0]).toBe('</script><script>alert(1)</script>')
  })

  it('keeps the runtime comparing integers: c survives as an integer array', () => {
    const html = buildPlayerHtml(deck())
    const parsed = JSON.parse(extractDeckJson(html))
    expect(parsed.pages[0].quiz.questions[0].c).toEqual([1])
    expect(parsed.pages[0].quiz.questions[0].c.every((x: unknown) => typeof x === 'number')).toBe(true)
  })

  it('the template FIB cap matches FIB_MAX_LEN (suspend estimator would drift otherwise)', async () => {
    const { FIB_MAX_LEN } = await import('./suspend')
    expect(buildPlayerHtml(deck())).toContain(`maxlength="${FIB_MAX_LEN}"`)
  })

  it('unthemed decks get an EMPTY theme style block — output stays byte-stable', () => {
    const html = buildPlayerHtml(deck())
    expect(html).not.toContain('__THEME_CSS__')
    expect(html).toContain('<style id="theme"></style>')
    // built-in palette untouched
    expect(html).toContain('--teal:#3194A0')
  })

  it('a themed deck injects the override block', () => {
    const html = buildPlayerHtml(deck({ theme: { scheme: 'light', primary: '#aa1122', font: 'serif' } }))
    expect(html).toContain('<style id="theme">:root{--teal:#aa1122')
    expect(html).toContain('--bg:#f4f6f8')
  })
})
