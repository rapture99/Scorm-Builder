// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { buildPlayerHtml } from './player'
import type { Deck } from './types'

/**
 * Boots the ACTUAL exported player (template + runtime JS) in a DOM and
 * exercises the core learner flow. This is what guards the inline player
 * script — no other test executes it.
 */

function twoPageDeck(): Deck {
  return {
    title: 'Runtime Test Course',
    passMark: 70,
    scormVersion: '1.2',
    pages: [
      { title: 'Intro', bodyHtml: '<p>welcome</p>', video: null, image: null, quiz: null },
      {
        title: 'Quiz page',
        bodyHtml: '',
        video: null,
        image: null,
        quiz: {
          questions: [
            { n: 1, q: 'Pick A', o: ['right', 'wrong'], c: [0], t: 'MCQ' },
            { n: 2, q: 'Pick B', o: ['wrong', 'right'], c: [1], t: 'MCQ' },
          ],
        },
      },
    ],
  }
}

function bootPlayer(deck: Deck): void {
  const html = buildPlayerHtml(deck)
  const body = html.match(/<body>([\s\S]*)<\/body>/)![1]
  // strip the runtime <script> (innerHTML doesn't execute it) but keep the DECK json tag
  const runtime = [...body.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs]) => !attrs?.includes('application/json'))
    .map(([, , src]) => src)
  const domOnly = body.replace(/<script>[\s\S]*?<\/script>/g, '')
  document.body.innerHTML = domOnly
  window.scrollTo = () => {}
  for (const src of runtime) new Function(src)()
}

const $ = (id: string) => document.getElementById(id)!
const stageText = () => $('stage').textContent ?? ''

/** Minimal LMS API stub for either dialect; records every value written. */
function mockApi(kind: '1.2' | '2004') {
  const store: Record<string, string> = {}
  const calls: string[] = []
  const ok = (name: string) => () => {
    calls.push(name)
    return 'true'
  }
  const api =
    kind === '2004'
      ? {
          Initialize: ok('Initialize'),
          Terminate: ok('Terminate'),
          Commit: ok('Commit'),
          GetValue: (k: string) => store[k] ?? '',
          SetValue: (k: string, v: string) => ((store[k] = String(v)), 'true'),
        }
      : {
          LMSInitialize: ok('LMSInitialize'),
          LMSFinish: ok('LMSFinish'),
          LMSCommit: ok('LMSCommit'),
          LMSGetValue: (k: string) => store[k] ?? '',
          LMSSetValue: (k: string, v: string) => ((store[k] = String(v)), 'true'),
        }
  return { store, calls, api }
}

const win = window as unknown as Record<string, unknown>

describe('exported player runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete win.API
    delete win.API_1484_11
  })

  it('boots into preview mode and renders page 1', () => {
    bootPlayer(twoPageDeck())
    expect($('ctitle').textContent).toBe('Runtime Test Course')
    expect($('connTxt').textContent).toBe('Preview mode')
    expect(stageText()).toContain('Page 1 of 2')
    expect(stageText()).toContain('Intro')
  })

  it('renders bodyHtml as real markup (built-time-sanitized rich text)', () => {
    const deck = twoPageDeck()
    deck.pages[0].bodyHtml = '<h2>Heading</h2><p><strong>bold</strong> text</p><ul><li>item</li></ul>'
    bootPlayer(deck)
    const body = document.querySelector('#stage .body-txt')!
    expect(body.querySelector('h2')?.textContent).toBe('Heading')
    expect(body.querySelector('strong')?.textContent).toBe('bold')
    expect(body.querySelectorAll('li')).toHaveLength(1)
  })

  it('navigates, blocks Finish until all answered, then grades 100% as passed', () => {
    bootPlayer(twoPageDeck())
    ;($('nextBtn') as HTMLButtonElement).click()
    expect(stageText()).toContain('Page 2 of 2')
    expect(stageText()).toContain('Pick A')

    const next = $('nextBtn') as HTMLButtonElement
    expect(next.textContent).toBe('Finish course')
    expect(next.disabled).toBe(true)

    // answer both correctly (integer index comparison: c=0 then c=1)
    ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
    ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
    expect(next.disabled).toBe(false)

    next.click()
    expect($('veil2').classList.contains('show')).toBe(true)
    expect($('scoreVal').textContent).toBe('100')
    expect($('stCorrect').textContent).toBe('2 / 2')
    expect($('statusLine').textContent).toContain('Passed')
    // review state marks the correct options
    expect(document.querySelectorAll('.q.rev').length).toBe(2)
  })

  it('fails below the pass mark', () => {
    bootPlayer(twoPageDeck())
    ;($('nextBtn') as HTMLButtonElement).click()
    ;(document.querySelector('input[name="p1q0"][value="1"]') as HTMLInputElement).click() // wrong
    ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click() // right
    ;($('nextBtn') as HTMLButtonElement).click()
    expect($('scoreVal').textContent).toBe('50')
    expect($('statusLine').textContent).toContain('Not passed')
  })

  it('a deck with no quizzes completes instead of grading', () => {
    const deck = twoPageDeck()
    deck.pages[1].quiz = null
    bootPlayer(deck)
    ;($('nextBtn') as HTMLButtonElement).click()
    const next = $('nextBtn') as HTMLButtonElement
    expect(next.textContent).toBe('Complete')
    next.click()
    expect($('veil2').classList.contains('show')).toBe(true)
    expect($('statusLine').textContent).toContain('Completed')
  })

  it('MCA renders checkboxes and grades by exact set match', () => {
    const deck = twoPageDeck()
    deck.pages = [
      {
        title: 'MCA page', bodyHtml: '', video: null, image: null,
        quiz: { questions: [{ n: 1, q: 'Pick A and C', o: ['a', 'b', 'c', 'd'], c: [0, 2], t: 'MCA' }] },
      },
    ]
    bootPlayer(deck)
    expect(stageText()).toContain('Select all that apply')
    const boxes = document.querySelectorAll('input[name="p0q0"]')
    expect(boxes).toHaveLength(4)
    expect((boxes[0] as HTMLInputElement).type).toBe('checkbox')

    // exact correct set → 100%
    ;(boxes[0] as HTMLInputElement).click()
    ;(boxes[2] as HTMLInputElement).click()
    const next = $('nextBtn') as HTMLButtonElement
    expect(next.disabled).toBe(false)
    next.click()
    expect($('scoreVal').textContent).toBe('100')
    expect($('statusLine').textContent).toContain('Passed')
  })

  it('MCA partial selection is answered but graded wrong (all-or-nothing)', () => {
    const deck = twoPageDeck()
    deck.pages = [
      {
        title: 'MCA page', bodyHtml: '', video: null, image: null,
        quiz: { questions: [{ n: 1, q: 'Pick A and C', o: ['a', 'b', 'c'], c: [0, 2], t: 'MCA' }] },
      },
    ]
    bootPlayer(deck)
    ;(document.querySelectorAll('input[name="p0q0"]')[0] as HTMLInputElement).click() // only A
    const next = $('nextBtn') as HTMLButtonElement
    expect(next.disabled).toBe(false) // answered — one selection is enough to submit
    next.click()
    expect($('scoreVal').textContent).toBe('0')
    expect($('statusLine').textContent).toContain('Not passed')
    // review shows the missed correct option and the verdict lists all correct letters
    expect($('stage').innerHTML).toContain('answer: A, C')
  })

  it('TF renders radios and accepts the true/false answer', () => {
    const deck = twoPageDeck()
    deck.pages = [
      {
        title: 'TF page', bodyHtml: '', video: null, image: null,
        quiz: { questions: [{ n: 1, q: 'Rule 5 requires a lookout', o: ['True', 'False'], c: [0], t: 'TF' }] },
      },
    ]
    bootPlayer(deck)
    const inputs = document.querySelectorAll('input[name="p0q0"]')
    expect((inputs[0] as HTMLInputElement).type).toBe('radio')
    ;(inputs[0] as HTMLInputElement).click()
    ;($('nextBtn') as HTMLButtonElement).click()
    expect($('scoreVal').textContent).toBe('100')
  })

  it('renders video with a direct src (no <source> child) inside the 80vh hero wrapper', () => {
    // <source> children injected via innerHTML don't reliably start loading —
    // the player must set src on the element itself (plus call load())
    const deck = twoPageDeck()
    deck.pages[0].video = { src: 'assets/p1_R_005.mp4' }
    bootPlayer(deck)
    const vid = document.querySelector('video#vid') as HTMLVideoElement
    expect(vid).not.toBeNull()
    expect(vid.getAttribute('src')).toBe('assets/p1_R_005.mp4')
    expect(vid.getAttribute('preload')).toBe('auto')
    expect(vid.querySelector('source')).toBeNull()
    expect(vid.closest('.vid-hero')).not.toBeNull()
    expect($('watched').textContent).toContain('Not yet viewed')
    // still present after navigating away and back
    ;($('nextBtn') as HTMLButtonElement).click()
    ;($('prevBtn') as HTMLButtonElement).click()
    expect((document.querySelector('video#vid') as HTMLVideoElement).getAttribute('src')).toBe('assets/p1_R_005.mp4')
  })

  it('video download is deterred: no download control, context menu blocked', () => {
    const deck = twoPageDeck()
    deck.pages[0].video = { src: 'assets/p1_R_005.mp4' }
    bootPlayer(deck)
    const vid = document.querySelector('video#vid') as HTMLVideoElement
    // Chromium: strips the ⋮ Download entry from the native controls
    expect(vid.getAttribute('controlslist')).toBe('nodownload')
    // right-click "Save video as…" (the only download path Firefox offers) is cancelled
    const ctx = new Event('contextmenu', { bubbles: true, cancelable: true })
    vid.dispatchEvent(ctx)
    expect(ctx.defaultPrevented).toBe(true)
    // …but the rest of the page keeps its context menu
    const bodyCtx = new Event('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(bodyCtx)
    expect(bodyCtx.defaultPrevented).toBe(false)
  })

  it('retake resets answers and re-enables inputs', () => {
    bootPlayer(twoPageDeck())
    ;($('nextBtn') as HTMLButtonElement).click()
    ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
    ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
    ;($('nextBtn') as HTMLButtonElement).click()
    ;($('retakeBtn') as HTMLButtonElement).click()
    expect($('veil2').classList.contains('show')).toBe(false)
    expect(stageText()).toContain('Page 1 of 2')
    // back on the quiz page, inputs are enabled and cleared
    ;($('nextBtn') as HTMLButtonElement).click()
    const input = document.querySelector('input[name="p1q0"]') as HTMLInputElement
    expect(input.disabled).toBe(false)
    expect(document.querySelectorAll('input:checked').length).toBe(0)
  })

  describe('SCORM API binding', () => {
    function answerBoth(q0: '0' | '1', q1: '0' | '1'): void {
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector(`input[name="p1q0"][value="${q0}"]`) as HTMLInputElement).click()
      ;(document.querySelector(`input[name="p1q1"][value="${q1}"]`) as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
    }

    it('1.2: binds window.API and reports via the cmi.core.* model', () => {
      const m = mockApi('1.2')
      win.API = m.api
      bootPlayer(twoPageDeck())
      expect($('connTxt').textContent).toBe('Platform connected')
      expect(m.calls).toContain('LMSInitialize')
      expect(m.store['cmi.core.lesson_status']).toBe('incomplete')

      answerBoth('1', '1') // one wrong, one right → 50%, below the 70 pass mark
      expect(m.store['cmi.core.score.raw']).toBe('50')
      expect(m.store['cmi.core.lesson_status']).toBe('failed')
      expect(m.store['cmi.core.session_time']).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{2}$/)
      expect(m.store['cmi.suspend_data']).toBeTruthy()

      window.dispatchEvent(new Event('beforeunload'))
      expect(m.calls).toContain('LMSFinish')
    })

    it('2004: binds window.API_1484_11 and reports completion + success + scaled score', () => {
      const m = mockApi('2004')
      win.API_1484_11 = m.api
      bootPlayer({ ...twoPageDeck(), scormVersion: '2004' })
      expect($('connTxt').textContent).toBe('Platform connected')
      expect(m.calls).toContain('Initialize')
      // 2004 boots with completion_status "unknown"/"" → begin the attempt as incomplete
      expect(m.store['cmi.completion_status']).toBe('incomplete')

      answerBoth('0', '1') // both right → 100%
      expect(m.store['cmi.score.raw']).toBe('100')
      expect(m.store['cmi.score.scaled']).toBe('1')
      expect(m.store['cmi.success_status']).toBe('passed')
      expect(m.store['cmi.completion_status']).toBe('completed')
      expect(m.store['cmi.session_time']).toMatch(/^PT\d+H\d+M\d+S$/)
      expect(m.store['cmi.exit']).toBe('normal')
      // 1.2 keys must never leak into a 2004 session
      expect(Object.keys(m.store).some((k) => k.startsWith('cmi.core.'))).toBe(false)

      window.dispatchEvent(new Event('beforeunload'))
      expect(m.calls).toContain('Terminate')
    })

    it('2004: a failed attempt reports success_status failed with the scaled score', () => {
      const m = mockApi('2004')
      win.API_1484_11 = m.api
      bootPlayer({ ...twoPageDeck(), scormVersion: '2004' })
      answerBoth('1', '1') // 50% < 70
      expect(m.store['cmi.score.scaled']).toBe('0.5')
      expect(m.store['cmi.success_status']).toBe('failed')
      expect(m.store['cmi.completion_status']).toBe('completed')
    })

    it('a 2004 package falls back to a 1.2-only LMS API (and vice versa)', () => {
      const m12 = mockApi('1.2')
      win.API = m12.api
      bootPlayer({ ...twoPageDeck(), scormVersion: '2004' })
      expect($('connTxt').textContent).toBe('Platform connected')
      answerBoth('0', '1')
      // bound the 1.2 API it actually found → speaks the 1.2 data model
      expect(m12.store['cmi.core.score.raw']).toBe('100')
      expect(m12.store['cmi.core.lesson_status']).toBe('passed')

      document.body.innerHTML = ''
      delete win.API
      const m04 = mockApi('2004')
      win.API_1484_11 = m04.api
      bootPlayer(twoPageDeck()) // 1.2 package on a 2004-only LMS
      answerBoth('0', '1')
      expect(m04.store['cmi.score.scaled']).toBe('1')
      expect(m04.store['cmi.success_status']).toBe('passed')
    })

    it('resumes from suspend_data stored on the LMS', () => {
      const m = mockApi('2004')
      m.store['cmi.suspend_data'] = JSON.stringify({ a: { 1: [0, null] }, w: {}, sub: 0, cp: 1 })
      win.API_1484_11 = m.api
      bootPlayer({ ...twoPageDeck(), scormVersion: '2004' })
      expect(stageText()).toContain('Page 2 of 2')
      expect((document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).checked).toBe(true)
    })
  })

  /** One quiz page, one deck-level override — the harness for the new types. */
  function quizDeck(questions: NonNullable<Deck['pages'][0]['quiz']>['questions'], deckOver: Partial<Deck> = {}, quizOver: object = {}): Deck {
    return {
      title: 'T', passMark: 70, scormVersion: '1.2',
      pages: [{ title: 'Q page', bodyHtml: '', video: null, image: null, quiz: { questions, ...quizOver } }],
      ...deckOver,
    }
  }
  function typeInto(el: HTMLInputElement, text: string): void {
    el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const finish = () => ($('nextBtn') as HTMLButtonElement).click()

  describe('new question types', () => {
    it('FIB: text input, graded case/whitespace-insensitively against any accepted answer', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Course and ___', o: [], c: [], t: 'FIB', a: ['speed', 'her speed'] }]))
      const input = document.querySelector('.tin') as HTMLInputElement
      expect(input.type).toBe('text')
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true)
      typeInto(input, '  HER   Speed ')
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(false)
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('FIB: a wrong answer reviews with the accepted answer shown', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Course and ___', o: [], c: [], t: 'FIB', a: ['speed'] }]))
      typeInto(document.querySelector('.tin') as HTMLInputElement, 'heading')
      finish()
      expect($('scoreVal').textContent).toBe('0')
      expect(stageText()).toContain('answer: speed')
      expect((document.querySelector('.tin') as HTMLInputElement).disabled).toBe(true)
    })

    it('NUM: grades within tolerance, rejects outside it', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Safe CPA?', o: [], c: [], t: 'NUM', num: { v: 1.5, tol: 0.2 } }]))
      const input = document.querySelector('.tin') as HTMLInputElement
      expect(input.type).toBe('number')
      typeInto(input, '1.6')
      finish()
      expect($('scoreVal').textContent).toBe('100')
      ;($('retakeBtn') as HTMLButtonElement).click()
      typeInto(document.querySelector('.tin') as HTMLInputElement, '1.8')
      finish()
      expect($('scoreVal').textContent).toBe('0')
      expect(stageText()).toContain('answer: 1.5 ± 0.2')
    })

    it('MAT: one select per left item; matching by right-text equality', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Match', o: ['Port', 'Starboard'], c: [0, 1], t: 'MAT', m: ['Left', 'Right'] }]))
      const sels = [...document.querySelectorAll('select.msel')] as HTMLSelectElement[]
      expect(sels).toHaveLength(2)
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true)

      const pick = (sel: HTMLSelectElement, text: string) => {
        const opt = [...sel.options].find((o) => o.textContent === text)!
        sel.value = opt.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
      pick(sels[0], 'Left')
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true) // half-answered
      pick(sels[1], 'Right')
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(false)
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('MAT: duplicate right-side labels grade fairly (text equality, not index)', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Match', o: ['a', 'b', 'c'], c: [0, 1, 2], t: 'MAT', m: ['same', 'same', 'other'] }]))
      const sels = [...document.querySelectorAll('select.msel')] as HTMLSelectElement[]
      // pick "same" for rows 0 and 1 by choosing the OTHER canonical index each time
      const byText = (sel: HTMLSelectElement, text: string, nth: number) =>
        [...sel.options].filter((o) => o.textContent === text)[nth].value
      sels[0].value = byText(sels[0], 'same', 1) // canonical index 1 for a row expecting m[0]='same'
      sels[0].dispatchEvent(new Event('change', { bubbles: true }))
      sels[1].value = byText(sels[1], 'same', 0)
      sels[1].dispatchEvent(new Event('change', { bubbles: true }))
      sels[2].value = byText(sels[2], 'other', 0)
      sels[2].dispatchEvent(new Event('change', { bubbles: true }))
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('SEQ: starts in a non-correct order, ▲/▼ reorder to correct grades 100%', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Order', o: ['first', 'second', 'third'], c: [0, 1, 2], t: 'SEQ' }]))
      const texts = () => [...document.querySelectorAll('.srow .stxt')].map((e) => e.textContent)
      expect(texts()).not.toEqual(['first', 'second', 'third']) // never pre-solved
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true) // untouched = unanswered

      const want = ['first', 'second', 'third']
      for (let target = 0; target < want.length; target++) {
        let idx = texts().indexOf(want[target])
        while (idx > target) {
          ;(document.querySelectorAll('.srow')[idx].querySelector('.sbtn[data-dir="-1"]') as HTMLButtonElement).click()
          idx = texts().indexOf(want[target])
        }
      }
      expect(texts()).toEqual(want)
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(false)
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('SEQ: a wrong order reviews with the correct order listed', () => {
      bootPlayer(quizDeck([{ n: 1, q: 'Order', o: ['x', 'y'], c: [0, 1], t: 'SEQ' }]))
      // starts as [y, x] (only non-correct order of 2); one swap makes it correct, two swaps wrong again
      ;(document.querySelector('.sbtn[data-dir="-1"]:not([disabled])') as HTMLButtonElement).click()
      ;(document.querySelector('.sbtn[data-dir="-1"]:not([disabled])') as HTMLButtonElement).click()
      finish()
      expect($('scoreVal').textContent).toBe('0')
      expect(stageText()).toContain('Correct order: x → y')
    })

    it('per-question feedback appears only after grading, picking the right variant', () => {
      bootPlayer(quizDeck([
        { n: 1, q: 'Right one', o: ['a', 'b'], c: [0], t: 'MCQ', fbc: 'Nailed it', fbi: 'Study Rule 5' },
        { n: 2, q: 'Wrong one', o: ['a', 'b'], c: [0], t: 'MCQ', fb: 'General note' },
      ]))
      expect(document.querySelector('.fb')).toBeNull()
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p0q1"][value="1"]') as HTMLInputElement).click()
      finish()
      const fbs = [...document.querySelectorAll('.fb')].map((e) => e.textContent)
      expect(fbs).toEqual(['Nailed it', 'General note'])
    })

    it('a mixed page (radio + typed + select) gates Finish on all of them', () => {
      bootPlayer(quizDeck([
        { n: 1, q: 'Pick', o: ['a', 'b'], c: [0], t: 'MCQ' },
        { n: 2, q: 'Type', o: [], c: [], t: 'FIB', a: ['x'] },
        { n: 3, q: 'Match', o: ['l1', 'l2'], c: [0, 1], t: 'MAT', m: ['r1', 'r2'] },
      ]))
      const next = $('nextBtn') as HTMLButtonElement
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      expect(next.disabled).toBe(true)
      typeInto(document.querySelector('.tin') as HTMLInputElement, 'x')
      expect(next.disabled).toBe(true)
      for (const sel of [...document.querySelectorAll('select.msel')] as HTMLSelectElement[]) {
        const li = +sel.getAttribute('data-i')!
        sel.value = String(li) // pick the aligned right item — correct by construction
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
      expect(next.disabled).toBe(false)
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('the result card lists per-question chips that jump back into review', () => {
      bootPlayer(twoPageDeck())
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click() // right
      ;(document.querySelector('input[name="p1q1"][value="0"]') as HTMLInputElement).click() // wrong
      ;($('nextBtn') as HTMLButtonElement).click()
      const chips = [...document.querySelectorAll('#qsum .chip')]
      expect(chips.map((c) => c.textContent)).toEqual(['P2·Q1 ✓', 'P2·Q2 ✗'])
      expect(chips[0].className).toContain('ok')
      expect(chips[1].className).toContain('bad')
      ;(chips[1] as HTMLButtonElement).click()
      expect($('veil2').classList.contains('show')).toBe(false)
      expect(stageText()).toContain('Page 2 of 2')
    })
  })

  describe('content blocks', () => {
    type DeckBlocks = NonNullable<Deck['pages'][0]['blocks']>
    function blockDeck(blocks: DeckBlocks, page: Partial<Deck['pages'][0]> = {}): Deck {
      return {
        title: 'B', passMark: 70, scormVersion: '1.2',
        pages: [{ title: 'Blocks page', bodyHtml: '<p>intro</p>', video: null, image: null, quiz: null, blocks, ...page }],
      }
    }

    it('accordion: real buttons with aria-expanded toggling hidden regions', () => {
      bootPlayer(blockDeck([{ kind: 'accordion', items: [{ title: 'One', bodyHtml: '<p><strong>b</strong></p>' }, { title: 'Two', bodyHtml: '<p>t</p>' }] }]))
      const btns = document.querySelectorAll('.acc-btn')
      expect(btns).toHaveLength(2)
      const btn = btns[0] as HTMLButtonElement
      const panel = document.getElementById(btn.getAttribute('aria-controls')!)!
      expect(btn.getAttribute('aria-expanded')).toBe('false')
      expect(panel.hasAttribute('hidden')).toBe(true)
      expect(panel.getAttribute('role')).toBe('region')
      btn.click()
      expect(btn.getAttribute('aria-expanded')).toBe('true')
      expect(panel.hasAttribute('hidden')).toBe(false)
      expect(panel.querySelector('strong')?.textContent).toBe('b')
      btn.click()
      expect(panel.hasAttribute('hidden')).toBe(true)
    })

    it('tabs: tablist semantics, click switching and arrow-key roving focus', () => {
      bootPlayer(blockDeck([{ kind: 'tabs', items: [{ title: 'A', bodyHtml: '<p>pa</p>' }, { title: 'B', bodyHtml: '<p>pb</p>' }, { title: 'C', bodyHtml: '<p>pc</p>' }] }]))
      const tabs = [...document.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
      const panels = [...document.querySelectorAll('[role="tabpanel"]')]
      expect(tabs).toHaveLength(3)
      expect(tabs[0].getAttribute('aria-selected')).toBe('true')
      expect(tabs[0].getAttribute('tabindex')).toBe('0')
      expect(tabs[1].getAttribute('tabindex')).toBe('-1')
      expect(panels[0].hasAttribute('hidden')).toBe(false)
      expect(panels[1].hasAttribute('hidden')).toBe(true)

      tabs[2].click()
      expect(tabs[2].getAttribute('aria-selected')).toBe('true')
      expect(tabs[0].getAttribute('aria-selected')).toBe('false')
      expect(panels[2].hasAttribute('hidden')).toBe(false)
      expect(panels[0].hasAttribute('hidden')).toBe(true)
      expect(document.activeElement).toBe(tabs[2])

      tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      expect(tabs[0].getAttribute('aria-selected')).toBe('true') // wraps
      expect(document.activeElement).toBe(tabs[0])
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    })

    it('flashcards: aria-pressed buttons flipping between sides', () => {
      bootPlayer(blockDeck([{ kind: 'flashcards', cards: [{ frontHtml: '<p>Q side</p>', backHtml: '<p>A side</p>' }] }]))
      const card = document.querySelector('.card-f') as HTMLButtonElement
      const sides = card.querySelectorAll('.cf-side')
      expect(card.getAttribute('aria-pressed')).toBe('false')
      expect(sides[1].hasAttribute('hidden')).toBe(true)
      card.click()
      expect(card.getAttribute('aria-pressed')).toBe('true')
      expect(sides[0].hasAttribute('hidden')).toBe(true)
      expect(sides[1].hasAttribute('hidden')).toBe(false)
      card.click()
      expect(sides[0].hasAttribute('hidden')).toBe(false)
    })

    it('reveal: prompt button shares the accordion toggle path', () => {
      bootPlayer(blockDeck([{ kind: 'reveal', prompt: 'Show the answer', bodyHtml: '<p>revealed</p>' }]))
      const btn = document.querySelector('.rev-btn') as HTMLButtonElement
      expect(btn.textContent).toBe('Show the answer')
      const panel = document.getElementById(btn.getAttribute('aria-controls')!)!
      expect(panel.hasAttribute('hidden')).toBe(true)
      btn.click()
      expect(panel.hasAttribute('hidden')).toBe(false)
      expect(stageText()).toContain('revealed')
    })

    it('timeline renders statically with no interactive controls', () => {
      bootPlayer(blockDeck([{ kind: 'timeline', items: [{ label: '1912', title: 'Event', bodyHtml: '<p>happened</p>' }] }]))
      const tl = document.querySelector('.tl')!
      expect(tl.textContent).toContain('1912')
      expect(tl.textContent).toContain('Event')
      expect(tl.querySelectorAll('button')).toHaveLength(0)
    })

    it('hotspots: labeled %-positioned markers, one open panel at a time', () => {
      bootPlayer(blockDeck([{
        kind: 'hotspots', image: { src: 'assets/p1_map.png' },
        spots: [
          { x: 25.5, y: 70, title: 'Bridge', bodyHtml: '<p>the bridge</p>' },
          { x: 80, y: 10, title: '', bodyHtml: '<p>unnamed</p>' },
        ],
      }]))
      expect((document.querySelector('.hs-fig img') as HTMLImageElement).getAttribute('src')).toBe('assets/p1_map.png')
      const dots = [...document.querySelectorAll('.hs-dot')] as HTMLButtonElement[]
      expect(dots[0].getAttribute('style')).toContain('left:25.5%')
      expect(dots[0].getAttribute('style')).toContain('top:70%')
      expect(dots[0].getAttribute('aria-label')).toBe('Bridge')
      expect(dots[1].getAttribute('aria-label')).toBe('Marker 2')
      const panels = [...document.querySelectorAll('.hs-panel')]
      expect(panels.every((p) => p.hasAttribute('hidden'))).toBe(true)
      dots[0].click()
      expect(panels[0].hasAttribute('hidden')).toBe(false)
      dots[1].click() // opening #2 closes #1
      expect(panels[0].hasAttribute('hidden')).toBe(true)
      expect(panels[1].hasAttribute('hidden')).toBe(false)
      dots[1].click() // re-click closes
      expect(panels[1].hasAttribute('hidden')).toBe(true)
    })

    it('blocks sit between body text and media, stay live after grading, and never touch suspend', () => {
      const m = mockApi('1.2')
      win.API = m.api
      bootPlayer(blockDeck(
        [{ kind: 'accordion', items: [{ title: 'T', bodyHtml: '<p>x</p>' }] }],
        {
          video: { src: 'assets/v.mp4' },
          quiz: { questions: [{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }] },
        },
      ))
      // order: .body-txt then .blk then video
      const kids = [...document.querySelectorAll('#stage > *')].map((el) => el.className || el.tagName)
      expect(kids.indexOf('body-txt')).toBeLessThan(kids.findIndex((c) => String(c).includes('blk')))
      expect(kids.findIndex((c) => String(c).includes('blk'))).toBeLessThan(kids.findIndex((c) => String(c).includes('vid-hero')))

      // answer + grade; suspend snapshot, then block interactions must not change it
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      document.querySelector('video#vid')!.dispatchEvent(new Event('ended'))
      ;($('nextBtn') as HTMLButtonElement).click() // Finish
      const before = m.store['cmi.suspend_data']
      expect(JSON.parse(before).sub).toBe(1)

      const accBtn = document.querySelector('.acc-btn') as HTMLButtonElement
      accBtn.click() // still interactive after grading
      expect(accBtn.getAttribute('aria-expanded')).toBe('true')
      expect(m.store['cmi.suspend_data']).toBe(before) // byte-identical

      // and the graded quiz DOM was not re-rendered by the toggle
      expect((document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).checked).toBe(true)
    })

    it('block titles are escaped (bodies were sanitized at build)', () => {
      bootPlayer(blockDeck([{ kind: 'accordion', items: [{ title: '<img src=x onerror=alert(1)>', bodyHtml: '<p>ok</p>' }] }]))
      expect(document.querySelector('.acc-btn img')).toBeNull()
      expect(document.querySelector('.acc-btn')!.textContent).toContain('<img')
    })
  })

  describe('accessibility', () => {
    it('landmarks, dialog roles and labeled navigation are present', () => {
      bootPlayer(twoPageDeck())
      expect(document.querySelector('main.wrap')).not.toBeNull()
      expect(document.querySelector('nav.navbar')?.getAttribute('aria-label')).toBe('Course navigation')
      expect($('prevBtn').getAttribute('aria-label')).toBe('Previous page')
      const card = document.querySelector('.card')!
      expect(card.getAttribute('role')).toBe('dialog')
      expect(card.getAttribute('aria-modal')).toBe('true')
      expect($('lb').getAttribute('role')).toBe('dialog')
      expect($('lbClose').getAttribute('aria-label')).toContain('Close')
      const dots = [...document.querySelectorAll('.pdot')]
      expect(dots[0].getAttribute('aria-current')).toBe('page')
      expect(dots[1].getAttribute('aria-current')).toBeNull()
      expect(dots[1].getAttribute('aria-label')).toContain('Go to page 2')
    })

    it('the live region announces page changes and the grade result', () => {
      bootPlayer(twoPageDeck())
      expect($('live').textContent).toContain('Page 1 of 2')
      ;($('nextBtn') as HTMLButtonElement).click()
      expect($('live').textContent).toContain('Page 2 of 2')
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
      expect($('live').textContent).toContain('Score 100 percent')
      expect($('live').textContent).toContain('Passed')
    })

    it('grading moves focus into the result dialog; closing returns it to main content', () => {
      bootPlayer(twoPageDeck())
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
      expect(document.activeElement).toBe($('retakeBtn'))
      ;($('reviewBtn') as HTMLButtonElement).click()
      expect(document.activeElement).toBe(document.querySelector('main.wrap'))
    })

    it('lightbox: opens to the close button, Escape returns focus to the opener', () => {
      const deck = twoPageDeck()
      deck.pages[0].image = { src: 'assets/p1_E.png' }
      bootPlayer(deck)
      ;($('chartBtn') as HTMLButtonElement).click()
      expect($('lb').classList.contains('show')).toBe(true)
      expect(document.activeElement).toBe($('lbClose'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect($('lb').classList.contains('show')).toBe(false)
      expect(document.activeElement).toBe($('chartBtn'))
    })

    it('Escape also dismisses the result card, restoring main focus', () => {
      bootPlayer(twoPageDeck())
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect($('veil2').classList.contains('show')).toBe(false)
      expect(document.activeElement).toBe(document.querySelector('main.wrap'))
    })

    it('Tab wraps inside the open result dialog (focus trap)', () => {
      bootPlayer(twoPageDeck())
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p1q1"][value="1"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
      // last focusable in the card is retakeBtn; Tab from it wraps to the first
      ;($('retakeBtn') as HTMLButtonElement).focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      expect(document.activeElement).not.toBe($('retakeBtn'))
      expect($('veil2').contains(document.activeElement)).toBe(true)
    })

    it('the built player ships focus-visible styles for nav controls', () => {
      expect(buildPlayerHtml(twoPageDeck())).toContain('.pdot:focus-visible')
    })
  })

  describe('navigation: restricted mode + fail remediation', () => {
    function restrictedDeck(): Deck {
      return {
        title: 'R', passMark: 70, scormVersion: '1.2', navMode: 'restricted',
        pages: [
          { title: 'Video page', bodyHtml: '', video: { src: 'assets/v.mp4' }, image: null, quiz: null },
          { title: 'Quiz page', bodyHtml: '', video: null, image: null, quiz: { questions: [{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }] } },
          { title: 'End', bodyHtml: '<p>done</p>', video: null, image: null, quiz: null },
        ],
      }
    }

    it('Next and forward dots lock until the page is ready; backward stays free', () => {
      bootPlayer(restrictedDeck())
      const next = $('nextBtn') as HTMLButtonElement
      expect(next.disabled).toBe(true) // video unwatched
      const dots = () => [...document.querySelectorAll('.pdot')] as HTMLButtonElement[]
      expect(dots()[1].disabled).toBe(true)
      expect(dots()[2].disabled).toBe(true)

      document.querySelector('video#vid')!.dispatchEvent(new Event('ended'))
      expect(next.disabled).toBe(false)
      expect(dots()[1].disabled).toBe(false)
      expect(dots()[2].disabled).toBe(true) // quiz page not answered yet

      next.click() // to quiz page
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true)
      expect(dots()[0].disabled).toBe(false) // backward always allowed
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(false)
    })

    it('a page with BOTH quiz answered and media unwatched stays locked (full readiness)', () => {
      const deck = restrictedDeck()
      deck.pages[0].quiz = { questions: [{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }] }
      bootPlayer(deck)
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(true) // video still unwatched
      document.querySelector('video#vid')!.dispatchEvent(new Event('ended'))
      expect(($('nextBtn') as HTMLButtonElement).disabled).toBe(false)
    })

    it('resume clamps cur back to the first not-ready page', () => {
      const m = mockApi('1.2')
      // suspend says page 3, but page 1's video was never watched
      m.store['cmi.suspend_data'] = JSON.stringify({ a: {}, w: {}, sub: 0, cp: 2, sd: 7 })
      win.API = m.api
      bootPlayer(restrictedDeck())
      expect(stageText()).toContain('Page 1 of 3')
    })

    it('after grading, navigation roams free for review', () => {
      const deck = restrictedDeck()
      deck.pages[0].video = null // simplify: answer-only course
      bootPlayer(deck)
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click() // to End page
      ;($('nextBtn') as HTMLButtonElement).click() // Finish
      expect($('veil2').classList.contains('show')).toBe(true)
      const dots = [...document.querySelectorAll('.pdot')] as HTMLButtonElement[]
      expect(dots.every((d) => !d.disabled)).toBe(true)
    })

    it('fail remediation: button shows only on fail and jumps to the configured page', () => {
      const deck: Deck = {
        title: 'F', passMark: 70, scormVersion: '1.2', onFailPage: 0,
        pages: [
          { title: 'Material', bodyHtml: '<p>study me</p>', video: null, image: null, quiz: null },
          { title: 'Quiz', bodyHtml: '', video: null, image: null, quiz: { questions: [{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }] } },
        ],
      }
      bootPlayer(deck)
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="1"]') as HTMLInputElement).click() // wrong → fail
      ;($('nextBtn') as HTMLButtonElement).click()
      const rfb = $('reviewFailBtn') as HTMLButtonElement
      expect(rfb.style.display).not.toBe('none')
      rfb.click()
      expect($('veil2').classList.contains('show')).toBe(false)
      expect(stageText()).toContain('Page 1 of 2')
      expect(stageText()).toContain('study me')

      // pass → hidden
      document.body.innerHTML = ''
      bootPlayer(deck)
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="0"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click()
      expect(($('reviewFailBtn') as HTMLButtonElement).style.display).toBe('none')
    })

    it('decks without onFailPage never show the remediation button', () => {
      bootPlayer(twoPageDeck())
      ;($('nextBtn') as HTMLButtonElement).click()
      ;(document.querySelector('input[name="p1q0"][value="1"]') as HTMLInputElement).click()
      ;(document.querySelector('input[name="p1q1"][value="0"]') as HTMLInputElement).click()
      ;($('nextBtn') as HTMLButtonElement).click() // 0% → fail
      expect(($('reviewFailBtn') as HTMLButtonElement).style.display).toBe('none')
    })
  })

  describe('shuffle, draw and attempts', () => {
    it('option shuffle is seeded: order is deterministic across boots via the persisted sd', () => {
      const m = mockApi('1.2')
      win.API = m.api
      const deck = quizDeck(
        [{ n: 1, q: '?', o: ['a', 'b', 'c', 'd', 'e', 'f'], c: [0], t: 'MCQ' }],
        { shuffle: { o: 1 } },
      )
      bootPlayer(deck)
      const order1 = [...document.querySelectorAll('input[name="p0q0"]')].map((i) => (i as HTMLInputElement).value)
      expect(JSON.parse(m.store['cmi.suspend_data']).sd).toBeTypeOf('number') // seed saved at boot
      document.body.innerHTML = ''
      bootPlayer(deck) // same LMS store → same seed → same layout
      const order2 = [...document.querySelectorAll('input[name="p0q0"]')].map((i) => (i as HTMLInputElement).value)
      expect(order2).toEqual(order1)
    })

    it('answers restore correctly onto a shuffled layout (canonical index space)', () => {
      const m = mockApi('1.2')
      win.API = m.api
      const deck = quizDeck(
        [{ n: 1, q: '?', o: ['right', 'w1', 'w2', 'w3'], c: [0], t: 'MCQ' }],
        { shuffle: { o: 1 } },
      )
      bootPlayer(deck)
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      document.body.innerHTML = ''
      bootPlayer(deck)
      expect((document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).checked).toBe(true)
      finish()
      expect($('scoreVal').textContent).toBe('100')
    })

    it('TF never shuffles; "None of the above" stays pinned last', () => {
      for (let i = 0; i < 8; i++) {
        document.body.innerHTML = ''
        bootPlayer(quizDeck(
          [
            { n: 1, q: 'TF', o: ['True', 'False'], c: [0], t: 'TF' },
            { n: 2, q: 'Pinned', o: ['x', 'y', 'z', 'None of the above'], c: [0], t: 'MCQ' },
          ],
          { shuffle: { o: 1 } },
        ))
        const tf = [...document.querySelectorAll('input[name="p0q0"]')].map((el) => (el as HTMLInputElement).value)
        expect(tf).toEqual(['0', '1'])
        const last = [...document.querySelectorAll('input[name="p0q1"]')].pop() as HTMLInputElement
        expect(last.value).toBe('3')
      }
    })

    it('per-question sh:0 opts out of the course-level option shuffle', () => {
      for (let i = 0; i < 8; i++) {
        document.body.innerHTML = ''
        bootPlayer(quizDeck(
          [{ n: 1, q: 'locked', o: ['a', 'b', 'c', 'd'], c: [0], t: 'MCQ', sh: 0 }],
          { shuffle: { o: 1 } },
        ))
        const order = [...document.querySelectorAll('input[name="p0q0"]')].map((el) => (el as HTMLInputElement).value)
        expect(order).toEqual(['0', '1', '2', '3'])
      }
    })

    it('draw: 1 of 3 questions is presented and the total reflects it', () => {
      bootPlayer(quizDeck(
        [
          { n: 1, q: 'q1', o: ['a', 'b'], c: [0], t: 'MCQ' },
          { n: 2, q: 'q2', o: ['a', 'b'], c: [0], t: 'MCQ' },
          { n: 3, q: 'q3', o: ['a', 'b'], c: [0], t: 'MCQ' },
        ],
        {},
        { draw: 1 },
      ))
      const qs = document.querySelectorAll('.q')
      expect(qs).toHaveLength(1)
      ;(document.querySelector('.opts input[value="0"]') as HTMLInputElement).click()
      finish()
      expect($('stCorrect').textContent).toBe('1 / 1')
    })

    it('banks: per-bank draws plus always-shown bankless questions', () => {
      bootPlayer(quizDeck(
        [
          { n: 'e1', q: 'easy 1', o: ['a', 'b'], c: [0], t: 'MCQ', b: 0 },
          { n: 'e2', q: 'easy 2', o: ['a', 'b'], c: [0], t: 'MCQ', b: 0 },
          { n: 'x', q: 'always', o: ['a', 'b'], c: [0], t: 'MCQ' },
        ],
        {},
        { bd: [1] },
      ))
      expect(document.querySelectorAll('.q')).toHaveLength(2)
      expect(stageText()).toContain('always')
    })

    it('maxAttempts: retake disabled once spent, surviving resume', () => {
      const m = mockApi('1.2')
      win.API = m.api
      const deck = quizDeck([{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }], { maxAttempts: 1 })
      bootPlayer(deck)
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      finish()
      expect($('stAtt').textContent).toBe('1 / 1')
      const retake = $('retakeBtn') as HTMLButtonElement
      expect(retake.disabled).toBe(true)
      expect(retake.textContent).toBe('No attempts left')
      retake.click()
      expect($('veil2').classList.contains('show')).toBe(true) // still on the card

      document.body.innerHTML = ''
      bootPlayer(deck) // resume from the same LMS store: sub:1, at:1
      expect(($('retakeBtn') as HTMLButtonElement).disabled).toBe(true)
    })

    it('a themed deck swaps the SVG mark for the logo <img>', () => {
      const deck = twoPageDeck()
      deck.theme = { scheme: 'dark', primary: '#aa1122', font: 'sans', logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' }
      bootPlayer(deck)
      expect(document.querySelector('svg.mk')).toBeNull()
      const img = document.querySelector('img.mk') as HTMLImageElement
      expect(img).not.toBeNull()
      expect(img.getAttribute('src')).toContain('data:image/png')
    })

    it('audio gates completion like video: ended marks the page Listened/done', () => {
      const deck = twoPageDeck()
      deck.pages[0].audio = { src: 'assets/p1_narration.mp3' }
      bootPlayer(deck)
      expect($('awatched').textContent).toContain('Not yet listened')
      expect(document.querySelectorAll('.pdot.done')).toHaveLength(0)
      document.querySelector('audio#aud')!.dispatchEvent(new Event('ended'))
      expect($('awatched').textContent).toContain('Listened')
      expect(document.querySelectorAll('.pdot')[0].className).toContain('done')
    })

    it('a PDF page renders the iframe + always-visible link and marks viewed on open', () => {
      const deck = twoPageDeck()
      deck.pages[0].doc = { src: 'assets/p1_spec.pdf', name: 'spec.pdf' }
      const m = mockApi('1.2')
      win.API = m.api
      bootPlayer(deck)
      expect((document.querySelector('iframe.doc') as HTMLIFrameElement).getAttribute('src')).toBe('assets/p1_spec.pdf')
      const link = document.querySelector('a.doc-link') as HTMLAnchorElement
      expect(link.getAttribute('href')).toBe('assets/p1_spec.pdf')
      expect(link.textContent).toContain('spec.pdf')
      expect(document.querySelectorAll('.pdot')[0].className).toContain('done')
      expect(JSON.parse(m.store['cmi.suspend_data']).w[0] & 4).toBe(4)
    })

    it('a captioned video renders a default CC track; uncaptioned renders none', () => {
      const deck = twoPageDeck()
      deck.pages[0].video = { src: 'assets/v.mp4', captions: 'assets/v.vtt' }
      bootPlayer(deck)
      const track = document.querySelector('video#vid track') as HTMLTrackElement
      expect(track).not.toBeNull()
      expect(track.getAttribute('kind')).toBe('captions')
      expect(track.getAttribute('src')).toBe('assets/v.vtt')
      expect(track.hasAttribute('default')).toBe(true)

      document.body.innerHTML = ''
      const plain = twoPageDeck()
      plain.pages[0].video = { src: 'assets/v.mp4' }
      bootPlayer(plain)
      expect(document.querySelector('video#vid track')).toBeNull()
    })

    it('legacy suspend w:{0:1} still restores video-watched under the bitmask', () => {
      const m = mockApi('1.2')
      m.store['cmi.suspend_data'] = JSON.stringify({ a: {}, w: { 0: 1 }, sub: 0, cp: 0 })
      win.API = m.api
      const deck = twoPageDeck()
      deck.pages[0].video = { src: 'assets/v.mp4' }
      bootPlayer(deck)
      expect($('watched').textContent).toContain('Viewed')
      expect(document.querySelectorAll('.pdot')[0].className).toContain('done')
    })

    it('a page with video AND audio needs both before it counts as done', () => {
      const deck = twoPageDeck()
      deck.pages[0].video = { src: 'assets/v.mp4' }
      deck.pages[0].audio = { src: 'assets/a.mp3' }
      bootPlayer(deck)
      document.querySelector('video#vid')!.dispatchEvent(new Event('ended'))
      expect(document.querySelectorAll('.pdot')[0].className).not.toContain('done')
      document.querySelector('audio#aud')!.dispatchEvent(new Event('ended'))
      expect(document.querySelectorAll('.pdot')[0].className).toContain('done')
    })

    it('retake re-rolls the seed so the next attempt draws afresh', () => {
      const m = mockApi('1.2')
      win.API = m.api
      bootPlayer(quizDeck([{ n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ' }]))
      ;(document.querySelector('input[name="p0q0"][value="0"]') as HTMLInputElement).click()
      finish()
      const sdBefore = JSON.parse(m.store['cmi.suspend_data']).sd
      ;($('retakeBtn') as HTMLButtonElement).click()
      const after = JSON.parse(m.store['cmi.suspend_data'])
      expect(after.sd).not.toBe(sdBefore)
      expect(after.sub).toBe(0)
    })
  })
})
