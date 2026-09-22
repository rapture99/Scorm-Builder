import { describe, it, expect } from 'vitest'
import { buildExportDeck, buildPreviewDeck } from './deck'
import type { Block, Course, Question } from './types'

const fancyQuestion: Question = {
  n: 1,
  q: 'Fill it in',
  o: [],
  c: [],
  t: 'FIB',
  a: ['speed', 'her speed'],
  num: { v: 4, tol: 0.5 },
  m: ['Left'],
  fb: 'general',
  fbc: 'well done',
  fbi: 'see Rule 17',
  sh: 0,
  b: 2,
}

function course(): Course {
  return {
    title: 'T',
    passMark: 70,
    scormVersion: '1.2',
    maxAttempts: 3,
    shuffleQuestions: true,
    shuffleOptions: true,
    pages: [
      {
        id: 'p1',
        title: 'P',
        body: '',
        quiz: { sourceName: 's.xlsx', problems: [], warnings: ['note'], draw: 2, bd: [1, 2], bankNames: ['Easy', 'Hard'], questions: [fancyQuestion] },
      },
    ],
  }
}

describe('deck projection — new fields must survive into the deck (both paths)', () => {
  for (const [label, build] of [
    ['export', () => buildExportDeck(course()).deck],
    ['preview', () => buildPreviewDeck(course(), () => 'blob:x')],
  ] as const) {
    it(`${label}: question fields, quiz draw/bd and course settings all carried`, () => {
      const deck = build()
      const q = deck.pages[0].quiz!.questions[0]
      expect(q).toEqual(fancyQuestion) // every authored field reaches the player
      expect(deck.pages[0].quiz!.draw).toBe(2)
      expect(deck.pages[0].quiz!.bd).toEqual([1, 2])
      expect(deck.maxAttempts).toBe(3)
      expect(deck.shuffle).toEqual({ q: 1, o: 1 })
      // editor-only fields must NOT ship
      expect(JSON.stringify(deck)).not.toContain('bankNames')
      expect(JSON.stringify(deck)).not.toContain('warnings')
    })
  }

  it('projects every block kind: bodies rendered, ids stripped, empties dropped', () => {
    const blocks: Block[] = [
      { id: 'b1', kind: 'accordion', items: [{ id: 'i1', title: 'One', body: '**bold**' }, { id: 'i2', title: '', body: '' }] },
      { id: 'b2', kind: 'tabs', items: [{ id: 'i3', title: 'Tab A', body: 'text' }] },
      { id: 'b3', kind: 'flashcards', cards: [{ id: 'c1', front: 'F', back: 'B' }, { id: 'c2', front: ' ', back: '' }] },
      { id: 'b4', kind: 'reveal', prompt: '', body: 'hidden text' },
      { id: 'b5', kind: 'timeline', items: [{ id: 't1', label: '1912', title: 'Event', body: 'happened' }] },
      { id: 'b6', kind: 'hotspots', image: { mediaId: 'm1', name: 'map.png', size: 5, type: 'image/png' }, spots: [{ id: 's1', x: 150, y: -3, title: 'Spot', body: 'detail' }] },
      { id: 'b7', kind: 'accordion', items: [{ id: 'i9', title: ' ', body: '' }] }, // fully empty → dropped
      { id: 'b8', kind: 'hotspots', image: null, spots: [{ id: 's2', x: 1, y: 1, title: 'x', body: 'y' }] }, // no image → dropped
    ]
    const c = course()
    c.pages[0].quiz = null
    c.pages[0].blocks = blocks
    const { deck, assets } = buildExportDeck(c)
    const out = deck.pages[0].blocks!
    expect(out.map((b) => b.kind)).toEqual(['accordion', 'tabs', 'flashcards', 'reveal', 'timeline', 'hotspots'])
    expect(out[0]).toEqual({ kind: 'accordion', items: [{ title: 'One', bodyHtml: '<p><strong>bold</strong></p>' }] })
    expect(out[2]).toEqual({ kind: 'flashcards', cards: [{ frontHtml: '<p>F</p>', backHtml: '<p>B</p>' }] })
    expect(out[3]).toEqual({ kind: 'reveal', prompt: 'Reveal', bodyHtml: '<p>hidden text</p>' })
    const hs = out[5]
    if (hs.kind === 'hotspots') {
      expect(hs.image.src).toBe('assets/p1_map.png')
      expect(hs.spots[0]).toEqual({ x: 100, y: 0, title: 'Spot', bodyHtml: '<p>detail</p>' }) // clamped
    }
    expect(assets.some((a) => a.path === 'assets/p1_map.png')).toBe(true) // hotspot image is a packaged asset
    expect(JSON.stringify(deck)).not.toContain('"id"') // editor ids never ship

    // preview path resolves the hotspot image through urlFor
    const preview = buildPreviewDeck(c, () => 'blob:x')
    const phs = preview.pages[0].blocks!.find((b) => b.kind === 'hotspots')
    if (phs && phs.kind === 'hotspots') expect(phs.image.src).toBe('blob:x')
  })

  it('captions ship on the video object — and only when a video exists', () => {
    const c = course()
    c.pages[0].quiz = null
    c.pages[0].video = { mediaId: 'v1', name: 'R_005.mp4', size: 9, type: 'video/mp4' }
    c.pages[0].captions = { mediaId: 'cc1', name: 'R_005.vtt', size: 2, type: 'text/vtt' }
    const { deck, assets } = buildExportDeck(c)
    expect(deck.pages[0].video).toEqual({ src: 'assets/p1_R_005.mp4', captions: 'assets/p1_R_005.vtt' })
    expect(assets.some((a) => a.path === 'assets/p1_R_005.vtt')).toBe(true)

    const preview = buildPreviewDeck(c, (r) => `blob:${r.mediaId}`)
    expect(preview.pages[0].video).toEqual({ src: 'blob:v1', captions: 'blob:cc1' })

    c.pages[0].video = null // orphaned captions: no field, no asset
    const noVid = buildExportDeck(c)
    expect(noVid.deck.pages[0].video).toBeNull()
    expect(noVid.assets.some((a) => a.path.endsWith('.vtt'))).toBe(false)
  })

  it('navMode and onFailPage ride deckSettings on both paths', () => {
    const c = course()
    c.pages.push({ id: 'p2', title: 'Remediation', body: '' })
    c.navMode = 'restricted'
    c.onFailPageId = 'p2'
    for (const deck of [buildExportDeck(c).deck, buildPreviewDeck(c, () => 'blob:x')]) {
      expect(deck.navMode).toBe('restricted')
      expect(deck.onFailPage).toBe(1)
    }
    c.onFailPageId = 'deleted-page'
    expect('onFailPage' in buildExportDeck(c).deck).toBe(false) // stale pointer drops the field
    c.navMode = 'free'
    expect('navMode' in buildExportDeck(c).deck).toBe(false)
  })

  it('settings stay absent when off — deck JSON identical to the legacy shape', () => {
    const c = course()
    delete c.maxAttempts
    c.shuffleQuestions = false
    c.shuffleOptions = false
    c.pages[0].quiz = {
      sourceName: 's.xlsx',
      problems: [],
      questions: [{ n: 1, q: 'Q?', o: ['a', 'b'], c: [0], t: 'MCQ' }],
    }
    const { deck } = buildExportDeck(c)
    expect('maxAttempts' in deck).toBe(false)
    expect('shuffle' in deck).toBe(false)
    expect('theme' in deck).toBe(false)
    expect('blocks' in deck.pages[0]).toBe(false) // block-less pages keep the legacy shape
    const dq = deck.pages[0].quiz!
    expect(Object.keys(dq)).toEqual(['questions'])
    expect(Object.keys(dq.questions[0])).toEqual(['n', 'q', 'o', 'c', 't'])
  })
})
