import { describe, it, expect } from 'vitest'
import { isScorable, presentedCount } from './scoring'
import type { Question } from './types'

const q = (over: Partial<Question>): Question => ({ n: 1, q: 'Q?', o: [], c: [], t: 'MCQ', ...over })

describe('isScorable — the per-question export gate', () => {
  it('MCQ/MCA/TF need a non-empty c', () => {
    expect(isScorable(q({ t: 'MCQ', o: ['a', 'b'], c: [0] }))).toBe(true)
    expect(isScorable(q({ t: 'MCQ', o: ['a', 'b'], c: [] }))).toBe(false)
    expect(isScorable(q({ t: 'MCA', o: ['a', 'b', 'c'], c: [0, 2] }))).toBe(true)
    expect(isScorable(q({ t: 'TF', o: ['True', 'False'], c: [] }))).toBe(false)
  })

  it('FIB needs at least one accepted answer — c stays empty', () => {
    expect(isScorable(q({ t: 'FIB', a: ['speed'] }))).toBe(true)
    expect(isScorable(q({ t: 'FIB', a: [] }))).toBe(false)
    expect(isScorable(q({ t: 'FIB' }))).toBe(false)
  })

  it('NUM needs a finite value and tolerance — c stays empty', () => {
    expect(isScorable(q({ t: 'NUM', num: { v: 225, tol: 0 } }))).toBe(true)
    expect(isScorable(q({ t: 'NUM', num: { v: NaN, tol: 0 } }))).toBe(false)
    expect(isScorable(q({ t: 'NUM' }))).toBe(false)
  })

  it('MAT needs ≥2 pairs with rights aligned to lefts', () => {
    expect(isScorable(q({ t: 'MAT', o: ['Port', 'Bow'], m: ['Left', 'Front'], c: [0, 1] }))).toBe(true)
    expect(isScorable(q({ t: 'MAT', o: ['Port', 'Bow'], m: ['Left'], c: [0, 1] }))).toBe(false)
    expect(isScorable(q({ t: 'MAT', o: ['Port'], m: ['Left'], c: [0] }))).toBe(false)
    expect(isScorable(q({ t: 'MAT', o: ['Port', 'Bow'], m: ['Left', ''], c: [0, 1] }))).toBe(false)
  })

  it('SEQ needs c to be a full permutation of the options', () => {
    expect(isScorable(q({ t: 'SEQ', o: ['x', 'y', 'z'], c: [2, 0, 1] }))).toBe(true)
    expect(isScorable(q({ t: 'SEQ', o: ['x', 'y', 'z'], c: [0, 1] }))).toBe(false)
    expect(isScorable(q({ t: 'SEQ', o: ['x', 'y', 'z'], c: [0, 0, 1] }))).toBe(false)
    expect(isScorable(q({ t: 'SEQ', o: ['x'], c: [0] }))).toBe(false)
  })
})

describe('presentedCount', () => {
  const qs = (n: number, bank?: number) =>
    Array.from({ length: n }, (_, i) => q({ n: i + 1, ...(bank !== undefined ? { b: bank } : {}) }))

  it('defaults to every question', () => {
    expect(presentedCount({ questions: qs(5) })).toBe(5)
  })

  it('bankless draw shows N of M', () => {
    expect(presentedCount({ questions: qs(10), draw: 4 })).toBe(4)
  })

  it('an out-of-range draw is ignored', () => {
    expect(presentedCount({ questions: qs(3), draw: 3 })).toBe(3)
    expect(presentedCount({ questions: qs(3), draw: 0 })).toBe(3)
  })

  it('banks mode sums per-bank draws plus bankless questions', () => {
    const questions = [...qs(3, 0), ...qs(2, 1), ...qs(2)]
    expect(presentedCount({ questions, bd: [1, 2] })).toBe(5)
  })
})
