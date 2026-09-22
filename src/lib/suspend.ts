import type { Course, ScormVersion } from './types'

/**
 * SCORM 1.2 guarantees only ~4096 chars of cmi.suspend_data; SCORM 2004
 * (4th Ed.) guarantees 64,000. The player persists {a answers, w watched,
 * sub, cp, sd seed, at attempts} with short keys, so state stays small — but a
 * huge deck could still blow the ceiling. This estimates the worst case so the
 * UI can warn before an unresumable package ships.
 */

export const SUSPEND_LIMITS: Record<ScormVersion, number> = { '1.2': 4096, '2004': 64000 }

/** Player-enforced cap on FIB answers (template hardcodes maxlength="80" — drift-guarded in player.test.ts). */
export const FIB_MAX_LEN = 80

export function estimateSuspendSize(course: Course): number {
  const a: Record<number, unknown[]> = {}
  const w: Record<number, number> = {}
  course.pages.forEach((p, i) => {
    if (p.quiz?.questions?.length) {
      // worst case mirrors the runtime slot shapes; every CANONICAL question is
      // counted as answered — an upper bound over any drawn subset
      a[i] = p.quiz.questions.map((q) => {
        switch (q.t) {
          case 'MCA':
            return q.o.map((_, oi) => oi)
          case 'FIB':
            return 'x'.repeat(FIB_MAX_LEN)
          case 'NUM':
            return -123456.789
          case 'MAT':
            return q.o.map(() => 10)
          case 'SEQ':
            return q.o.map((_, oi) => oi)
          default:
            return 3
        }
      })
    }
    // watched is a per-page bitmask (video=1, audio=2, doc=4) — worst case all set
    if (p.video || p.audio || p.doc) w[i] = 7
  })
  const payload = JSON.stringify({ a, w, sub: 1, cp: Math.max(0, course.pages.length - 1), sd: 2147483647, at: 99 })
  return payload.length
}

export function suspendWarning(course: Course): string | null {
  const limit = SUSPEND_LIMITS[course.scormVersion]
  const size = estimateSuspendSize(course)
  if (size <= limit * 0.85) return null
  const pct = Math.round((size / limit) * 100)
  const label = `SCORM ${course.scormVersion}`
  return size > limit
    ? `Resume state (~${size} chars) exceeds the ${label} suspend_data limit of ${limit}. Resume will break on most LMSes — split this course${course.scormVersion === '1.2' ? ' or switch to SCORM 2004 (64k limit)' : ''}.`
    : `Resume state (~${size} chars) is at ${pct}% of the ${label} suspend_data limit (${limit}). Consider splitting the course${course.scormVersion === '1.2' ? ' or switching to SCORM 2004 (64k limit)' : ''}.`
}
