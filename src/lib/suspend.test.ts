import { describe, it, expect } from 'vitest'
import { estimateSuspendSize, suspendWarning, SUSPEND_LIMITS } from './suspend'
import type { Course, Page, ScormVersion } from './types'

function courseWith(pages: Page[], scormVersion: ScormVersion = '1.2'): Course {
  return { title: 'T', passMark: 70, scormVersion, pages }
}

function quizPage(id: string, questionCount: number): Page {
  return {
    id, title: id, body: '',
    quiz: {
      sourceName: 's.xlsx', problems: [],
      questions: Array.from({ length: questionCount }, (_, i) => ({ n: i + 1, q: 'q', o: ['a', 'b'], c: [0], t: 'MCQ' as const })),
    },
  }
}

describe('suspend_data size guard', () => {
  it('a normal deck stays far under the SCORM 1.2 ceiling', () => {
    const c = courseWith([quizPage('p1', 10), quizPage('p2', 10)])
    expect(estimateSuspendSize(c)).toBeLessThan(SUSPEND_LIMITS['1.2'] / 4)
    expect(suspendWarning(c)).toBeNull()
  })

  it('warns when a 1.2 deck exceeds the ceiling, suggesting 2004', () => {
    // ~250 pages × 15 answers ≈ way past 4096 chars of state
    const pages = Array.from({ length: 250 }, (_, i) => quizPage(`p${i}`, 15))
    const c = courseWith(pages)
    expect(estimateSuspendSize(c)).toBeGreaterThan(SUSPEND_LIMITS['1.2'])
    expect(suspendWarning(c)).toMatch(/exceeds/)
    expect(suspendWarning(c)).toMatch(/SCORM 2004/)
  })

  it('the same deck is fine under SCORM 2004 (64k ceiling)', () => {
    const pages = Array.from({ length: 250 }, (_, i) => quizPage(`p${i}`, 15))
    const c = courseWith(pages, '2004')
    expect(estimateSuspendSize(c)).toBeLessThan(SUSPEND_LIMITS['2004'])
    expect(suspendWarning(c)).toBeNull()
  })

  it('FIB questions are the new pressure: 45 of them trip the 1.2 warning', () => {
    const page: Page = {
      id: 'p1', title: '', body: '',
      quiz: {
        sourceName: 's.xlsx', problems: [],
        questions: Array.from({ length: 45 }, (_, i) => ({ n: i + 1, q: 'q', o: [], c: [], t: 'FIB' as const, a: ['x'] })),
      },
    }
    const c = courseWith([page])
    // worst case: 45 × ~83 chars ≈ 3.7k > 85% of the 4096 budget → warn
    expect(suspendWarning(c)).not.toBeNull()
    expect(suspendWarning(courseWith([page], '2004'))).toBeNull()
  })

  it('MAT/SEQ arrays and the seed are modeled in the worst case', () => {
    const page: Page = {
      id: 'p1', title: '', body: '',
      quiz: {
        sourceName: 's.xlsx', problems: [],
        questions: [
          { n: 1, q: 'q', o: ['a', 'b', 'c'], c: [0, 1, 2], t: 'MAT', m: ['x', 'y', 'z'] },
          { n: 2, q: 'q', o: ['a', 'b', 'c'], c: [2, 1, 0], t: 'SEQ' },
        ],
      },
    }
    const size = estimateSuspendSize(courseWith([page]))
    // {a:{0:[[10,10,10],[0,1,2]]},w:{},sub:1,cp:0,sd:…,at:99} — sanity band, not exact bytes
    expect(size).toBeGreaterThan(60)
    expect(size).toBeLessThan(200)
  })

  it('audio/doc pages add watched entries (bitmask worst case)', () => {
    const bare: Page = { id: 'p1', title: '', body: '' }
    const withMedia: Page = { ...bare, audio: { mediaId: 'a', name: 'n.mp3', size: 1, type: '' } }
    expect(estimateSuspendSize(courseWith([withMedia]))).toBeGreaterThan(estimateSuspendSize(courseWith([bare])))
  })
})
