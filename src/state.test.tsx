import { describe, it, expect } from 'vitest'
import { reducer, type EditorState } from './state'

const base: EditorState = {
  course: { title: 'T', passMark: 70, scormVersion: '1.2', pages: [] },
  selectedId: null,
  loaded: true,
}

describe('patchCourse', () => {
  it('merges runtime settings onto the course', () => {
    let s = reducer(base, { type: 'patchCourse', patch: { maxAttempts: 3 } })
    s = reducer(s, { type: 'patchCourse', patch: { shuffleQuestions: true, shuffleOptions: true } })
    expect(s.course.maxAttempts).toBe(3)
    expect(s.course.shuffleQuestions).toBe(true)
    expect(s.course.shuffleOptions).toBe(true)
    expect(s.course.passMark).toBe(70) // untouched fields survive
  })
})

describe('deletePage', () => {
  it('clears onFailPageId when its target page is deleted', () => {
    const s0: EditorState = {
      ...base,
      course: {
        ...base.course,
        onFailPageId: 'p2',
        pages: [
          { id: 'p1', title: '', body: '' },
          { id: 'p2', title: '', body: '' },
        ],
      },
    }
    const s1 = reducer(s0, { type: 'deletePage', id: 'p2' })
    expect('onFailPageId' in s1.course).toBe(false)
    const s2 = reducer(s0, { type: 'deletePage', id: 'p1' })
    expect(s2.course.onFailPageId).toBe('p2') // unrelated deletions keep it
  })
})

describe('patchPage — blocks', () => {
  it('replaces the blocks array and preserves the rest of the page', () => {
    const withPage: EditorState = {
      ...base,
      course: { ...base.course, pages: [{ id: 'p1', title: 'T', body: 'B' }] },
    }
    const blocks = [{ id: 'b1', kind: 'reveal' as const, prompt: 'Show', body: 'hidden' }]
    const s = reducer(withPage, { type: 'patchPage', id: 'p1', patch: { blocks } })
    expect(s.course.pages[0].blocks).toEqual(blocks)
    expect(s.course.pages[0].title).toBe('T')
    expect(s.course.pages[0].body).toBe('B')
  })
})
