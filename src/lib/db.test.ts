import { describe, it, expect } from 'vitest'
import { migrateCourse, referencedMediaIds, totalMediaBytes } from './db'
import { PAGE_MEDIA_KINDS, type Block, type Course, type MediaRef, type Page } from './types'

const ref = (id: string, size = 10): MediaRef => ({ mediaId: id, name: `${id}.bin`, size, type: '' })

describe('GC registry — referencedMediaIds / totalMediaBytes', () => {
  it('covers EVERY page media kind plus block media plus the theme logo (the orphan-GC tripwire)', () => {
    // one page carrying every kind in the registry — a kind added to Page but
    // not enumerated here would be pruned from IndexedDB 500ms after autosave
    const page: Page = { id: 'p1', title: '', body: '', quiz: null }
    PAGE_MEDIA_KINDS.forEach((k, i) => {
      page[k] = ref(`m-${k}`, i + 1)
    })
    // block-held media (hotspot image) must be reachable too, or uploading one gets it pruned
    page.blocks = [{ id: 'b1', kind: 'hotspots', image: ref('m-hotspot', 50), spots: [] }]
    const course: Course = {
      title: 't',
      passMark: 70,
      scormVersion: '1.2',
      pages: [page],
      theme: { scheme: 'dark', primary: '#3194A0', font: 'sans', logo: ref('m-logo', 100) },
    }
    const ids = referencedMediaIds(course)
    for (const k of PAGE_MEDIA_KINDS) expect(ids.has(`m-${k}`), `kind "${k}" missing from GC scan`).toBe(true)
    expect(ids.has('m-hotspot'), 'hotspot image missing from GC scan').toBe(true)
    expect(ids.has('m-logo')).toBe(true)
    const kindBytes = PAGE_MEDIA_KINDS.reduce((s, _k, i) => s + i + 1, 0)
    expect(totalMediaBytes(course)).toBe(kindBytes + 50 + 100)
  })
})

describe('migrateCourse', () => {
  const courseWith = (t: string, c: unknown): Course => ({
    title: 't',
    passMark: 70,
    scormVersion: '1.2',
    pages: [
      {
        id: 'p1',
        title: '',
        body: '',
        quiz: {
          sourceName: 's.xlsx',
          problems: [],
          questions: [{ n: 1, q: 'Q?', o: ['a', 'b'], c: c as number[], t: t as never }],
        },
      },
    ],
  })

  it('preserves every current question type — new types must not be clobbered to MCQ', () => {
    for (const t of ['MCQ', 'MCA', 'TF', 'FIB', 'NUM', 'MAT', 'SEQ']) {
      expect(migrateCourse(courseWith(t, [0])).pages[0].quiz!.questions[0].t).toBe(t)
    }
  })

  it('coerces unknown/legacy types to MCQ and integer c to an array', () => {
    const out = migrateCourse(courseWith('garbage', 1))
    expect(out.pages[0].quiz!.questions[0].t).toBe('MCQ')
    expect(out.pages[0].quiz!.questions[0].c).toEqual([1])
    expect(migrateCourse(courseWith('MCQ', -1)).pages[0].quiz!.questions[0].c).toEqual([])
    expect(migrateCourse(courseWith('MCQ', undefined)).pages[0].quiz!.questions[0].c).toEqual([])
  })

  it('normalizes blocks: unknown kinds dropped, missing ids backfilled, non-array removed', () => {
    const course: Course = {
      title: 't',
      passMark: 70,
      scormVersion: '1.2',
      pages: [
        {
          id: 'p1', title: '', body: '',
          blocks: [
            { id: '', kind: 'accordion', items: [{ id: '', title: 'a', body: 'b' }] },
            { kind: 'bogus' } as unknown as Block,
          ],
        },
        { id: 'p2', title: '', body: '', blocks: 'junk' as unknown as Block[] },
        { id: 'p3', title: '', body: '' },
      ],
    }
    const out = migrateCourse(course)
    expect(out.pages[0].blocks).toHaveLength(1)
    expect(out.pages[0].blocks![0].id).toBeTruthy()
    const acc = out.pages[0].blocks![0]
    if (acc.kind === 'accordion') expect(acc.items[0].id).toBeTruthy()
    expect('blocks' in out.pages[1]).toBe(false)
    expect('blocks' in out.pages[2]).toBe(false) // untouched pages stay block-less
  })
})
