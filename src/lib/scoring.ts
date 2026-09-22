import type { Question, Quiz } from './types'

/**
 * Can this question be graded? This is the export gate's per-question truth:
 * one unscorable question anywhere (including inside an undrawn bank subset)
 * blocks packaging. Each type carries its answer differently — see Question.
 */
export function isScorable(q: Question): boolean {
  switch (q.t) {
    case 'FIB':
      return (q.a?.length ?? 0) > 0
    case 'NUM':
      return q.num != null && Number.isFinite(q.num.v) && Number.isFinite(q.num.tol)
    case 'MAT':
      return q.o.length >= 2 && q.m?.length === q.o.length && q.m.every((s) => s !== '')
    case 'SEQ':
      return q.o.length >= 2 && isPermutation(q.c, q.o.length)
    default:
      return q.c.length > 0
  }
}

function isPermutation(c: number[], n: number): boolean {
  if (c.length !== n) return false
  const seen = new Set(c)
  if (seen.size !== n) return false
  for (let i = 0; i < n; i++) if (!seen.has(i)) return false
  return true
}

/** How many questions the learner actually sees, accounting for draw/banks. */
export function presentedCount(quiz: Pick<Quiz, 'questions' | 'draw' | 'bd'>): number {
  if (quiz.bd?.length) {
    const bankless = quiz.questions.filter((q) => q.b === undefined).length
    return bankless + quiz.bd.reduce((s, n) => s + n, 0)
  }
  if (quiz.draw && quiz.draw >= 1 && quiz.draw < quiz.questions.length) return quiz.draw
  return quiz.questions.length
}
