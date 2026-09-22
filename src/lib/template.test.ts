import { describe, it, expect } from 'vitest'
import { serializeTemplate, deserializeTemplate, TEMPLATE_VERSION } from './template'
import { migrateCourse } from './db'
import type { Course, MediaRef } from './types'

const ref = (name: string): MediaRef => ({ mediaId: `id-${name}`, name, size: 9, type: '' })

function richCourse(): Course {
  return {
    title: 'COLREGS',
    passMark: 80,
    scormVersion: '2004',
    maxAttempts: 2,
    shuffleQuestions: true,
    navMode: 'restricted',
    onFailPageId: 'p1',
    theme: { scheme: 'light', primary: '#aa1122', font: 'serif', logo: ref('logo.png') },
    pages: [
      {
        id: 'p1',
        title: 'Material',
        body: '# Heading',
        video: ref('R_005.mp4'),
        captions: ref('R_005.vtt'),
        blocks: [
          { id: 'b1', kind: 'hotspots', image: ref('map.png'), spots: [{ id: 's1', x: 10, y: 20, title: 'T', body: 'B' }] },
          { id: 'b2', kind: 'reveal', prompt: 'Show', body: 'hidden' },
        ],
      },
      {
        id: 'p2',
        title: 'Quiz',
        body: '',
        quiz: {
          sourceName: 'A_005.xlsx',
          problems: [],
          draw: 1,
          questions: [
            { n: 1, q: '?', o: ['a', 'b'], c: [0], t: 'MCQ', fb: 'note' },
            { n: 2, q: 'fill', o: [], c: [], t: 'FIB', a: ['x'] },
          ],
        },
      },
    ],
  }
}

describe('serializeTemplate', () => {
  it('strips every media ref into the manifest and keeps everything else', () => {
    const env = serializeTemplate(richCourse())
    expect(env.app).toBe('norm-scorm-builder')
    expect(env.kind).toBe('template')
    expect(env.version).toBe(TEMPLATE_VERSION)
    expect(JSON.stringify(env)).not.toContain('mediaId')
    expect(env.media).toEqual([
      { page: 1, kind: 'video', name: 'R_005.mp4' },
      { page: 1, kind: 'captions', name: 'R_005.vtt' },
      { page: 1, kind: 'hotspot', name: 'map.png' },
      { page: 0, kind: 'logo', name: 'logo.png' },
    ])
    // structure survives: quiz (all fields), blocks, settings, theme minus logo
    expect(env.course.pages[1].quiz!.questions[1].a).toEqual(['x'])
    expect(env.course.pages[1].quiz!.draw).toBe(1)
    expect(env.course.pages[0].blocks).toHaveLength(2)
    expect(env.course.maxAttempts).toBe(2)
    expect(env.course.navMode).toBe('restricted')
    expect(env.course.theme).toMatchObject({ scheme: 'light', primary: '#aa1122', logo: null })
    // the source course is untouched (deep copy)
    expect(richCourse().pages[0].video).not.toBeNull()
  })
})

describe('deserializeTemplate', () => {
  const json = () => JSON.stringify(serializeTemplate(richCourse()))

  it('round-trips structure, regenerating page ids and remapping onFailPageId', () => {
    const { course, media } = deserializeTemplate(json())
    expect(media).toHaveLength(4)
    expect(course.pages).toHaveLength(2)
    expect(course.pages[0].id).not.toBe('p1')
    expect(course.pages[1].id).not.toBe('p2')
    expect(course.onFailPageId).toBe(course.pages[0].id) // followed its page
    expect(course.pages[1].quiz!.questions[0].fb).toBe('note')
    // two loads of the same file yield disjoint id sets
    const again = deserializeTemplate(json())
    expect(again.course.pages[0].id).not.toBe(course.pages[0].id)
  })

  it('drops a stale onFailPageId that points nowhere', () => {
    const env = serializeTemplate(richCourse())
    env.course.onFailPageId = 'ghost'
    const { course } = deserializeTemplate(JSON.stringify(env))
    expect('onFailPageId' in course).toBe(false)
  })

  it('rejects non-templates with specific messages', () => {
    expect(() => deserializeTemplate('not json')).toThrow(/valid JSON/)
    expect(() => deserializeTemplate('{"app":"other"}')).toThrow(/Not a SCORM Builder template/)
    expect(() => deserializeTemplate(JSON.stringify({ app: 'norm-scorm-builder', kind: 'deck' }))).toThrow(/Not a SCORM Builder template/)
    expect(() => deserializeTemplate(JSON.stringify({ app: 'norm-scorm-builder', kind: 'template', version: TEMPLATE_VERSION + 1, course: { pages: [] } }))).toThrow(/newer version/)
    expect(() => deserializeTemplate(JSON.stringify({ app: 'norm-scorm-builder', kind: 'template', version: 1, course: {} }))).toThrow(/no pages array/)
  })

  it('composes with migrateCourse: legacy quiz data in a template normalizes on load', () => {
    const env = serializeTemplate(richCourse())
    // simulate a hand-edited template with pre-MCA-era data
    const q = env.course.pages[1].quiz!.questions[0] as unknown as { c: unknown; t: string }
    q.c = 1
    q.t = 'weird'
    const { course } = deserializeTemplate(JSON.stringify(env))
    const migrated = migrateCourse(course)
    expect(migrated.pages[1].quiz!.questions[0].c).toEqual([1])
    expect(migrated.pages[1].quiz!.questions[0].t).toBe('MCQ')
  })
})
