import * as XLSX from 'xlsx'
import type { Quiz, Question, QType } from './types'

/**
 * Excel/CSV quiz parsing.
 *
 * Correct-answer resolution for choice questions (the correctness rule this
 * app exists for):
 *   1. exact full-cell text match against an option (after trimming)
 *   2. single letter A–F fallback (case-insensitive)
 *   3. multiple answers (MCA): comma/semicolon-separated values, each resolved
 *      by the same text-then-letter rule, or compact letter runs ("AC", "A C")
 * True/False rows get extra tolerance: case-insensitive True/False/T/F, and
 * missing options auto-fill to True/False.
 *
 * Typed-answer and structured types are NEVER inferred — a row must declare
 * FIB/NUM/MAT/SEQ in the Question Type column, which is what keeps legacy
 * sheets parsing identically:
 *   FIB  Correct Answer = accepted answers separated by | ("speed|her speed")
 *   NUM  Correct Answer = 42 · 42±0.5 · 40..44 (or a Tolerance column)
 *   MAT  each option cell = one "left = right" pair (also :: -> → =>)
 *   SEQ  options are the items; Correct Answer = the right order ("C, A, D, B",
 *        "CADB", 1-based numbers, or full texts; blank = as listed)
 *
 * A row that resolves to nothing gradable gets an entry in `problems`; export
 * is blocked while any exist. `warnings` are non-blocking authoring notes.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  number: ['number', 'no', 'no.', '#', 'q', 'q#', 'qno', 'q no', 'sr', 'sr no', 'sr.no', 'sr. no', 's.no', 'sl no'],
  question: ['question', 'stem', 'question text', 'questions'],
  optA: ['option a', 'a', 'opt a', 'optiona', 'option 1', 'choice a'],
  optB: ['option b', 'b', 'opt b', 'optionb', 'option 2', 'choice b'],
  optC: ['option c', 'c', 'opt c', 'optionc', 'option 3', 'choice c'],
  optD: ['option d', 'd', 'opt d', 'optiond', 'option 4', 'choice d'],
  optE: ['option e', 'e', 'opt e', 'optione', 'option 5', 'choice e'],
  optF: ['option f', 'f', 'opt f', 'optionf', 'option 6', 'choice f'],
  correct: ['correct answer', 'correct', 'answer', 'key', 'correct option', 'ans'],
  type: ['question type', 'type', 'qtype'],
  feedback: ['feedback', 'explanation', 'rationale', 'remark', 'why'],
  feedbackCorrect: ['correct feedback', 'feedback correct', 'feedback (correct)', 'if correct', 'feedback when correct'],
  feedbackIncorrect: ['incorrect feedback', 'wrong feedback', 'feedback incorrect', 'feedback (incorrect)', 'if incorrect', 'if wrong'],
  tolerance: ['tolerance', 'tol', 'margin', 'plus minus', '+/-', '±'],
  shuffle: ['shuffle', 'shuffle options', 'shuffle answers', 'randomize', 'randomise'],
  bank: ['bank', 'pool', 'group', 'set'],
  draw: ['draw', 'pick', 'draw count', 'random draw', 'questions to show'],
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function cellText(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** Map a "Question Type" cell to a QType, or null when blank/unrecognized (→ inference). */
export function normalizeQType(raw: string): QType | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return null
  if (s === 'mca' || s.includes('multicorrect') || s.includes('multiplecorrect') || s.includes('multiselect') ||
      s.includes('multipleselect') || s.includes('multianswer') || s.includes('multipleanswer') ||
      s.includes('multipleresponse') || s.includes('checkbox') || s.includes('selectall')) return 'MCA'
  if (s === 'tf' || s.includes('truefalse') || s.includes('trueorfalse')) return 'TF'
  // new types come before MCQ — its 'single' check matches greedily
  if (s === 'fib' || s === 'blank' || s === 'text' || s.includes('fillintheblank') || s.includes('fillblank') ||
      s.includes('fillin') || s.includes('shortanswer') || s.includes('textentry') || s.includes('typedanswer')) return 'FIB'
  if (s === 'num' || s === 'numeric' || s === 'number' || s.includes('numericentry') ||
      s.includes('numericanswer') || s.includes('numericresponse')) return 'NUM'
  if (s === 'mat' || s === 'match' || s.includes('matching') || s.includes('matchthefollowing') || s.includes('pair')) return 'MAT'
  if (s === 'seq' || s.includes('sequenc') || s.includes('order') || s.includes('arrange') || s.includes('rank')) return 'SEQ'
  if (s === 'mcq' || s.includes('multiplechoice') || s.includes('singlechoice') || s.includes('single') || s.includes('radio')) return 'MCQ'
  return null
}

/** Do the options amount to a True/False pair? */
export function isTrueFalseOptions(options: string[]): boolean {
  if (options.length !== 2) return false
  const set = new Set(options.map((o) => o.trim().toLowerCase()))
  return set.has('true') && set.has('false')
}

function matchTextThenLetter(token: string, options: string[]): number {
  for (let i = 0; i < options.length; i++) if (options[i] === token) return i
  const li = LETTERS.indexOf(token.toUpperCase())
  if (li >= 0 && li < options.length) return li
  return -1
}

/**
 * Resolve a "Correct Answer" cell to sorted option indexes ([] = unresolved).
 * Exported separately so the resolution order is unit-testable in isolation.
 */
export function resolveCorrectIndexes(correctRaw: string, options: string[], qtype?: QType | null): number[] {
  const raw = correctRaw.trim()
  if (raw === '') return []

  // True/False tolerance: case-insensitive true/false, plus T/F shortcuts
  if (qtype === 'TF' || isTrueFalseOptions(options)) {
    const norm = raw.toLowerCase()
    const want = norm === 't' ? 'true' : norm === 'f' ? 'false' : norm
    const i = options.findIndex((o) => o.trim().toLowerCase() === want)
    if (i >= 0) return [i]
  }

  // (1) exact full-cell text match — wins even when the cell contains separators
  for (let i = 0; i < options.length; i++) {
    if (options[i] === raw) return [i]
  }
  // (2) single letter A–F
  const li = LETTERS.indexOf(raw.toUpperCase())
  if (li >= 0 && li < options.length) return [li]

  // (3) multiple answers: split on , ; / & + — every token must resolve
  const tokens = raw.split(/[,;/&+]+/).map((t) => t.trim()).filter(Boolean)
  if (tokens.length > 1) {
    const out: number[] = []
    for (const tok of tokens) {
      const idx = matchTextThenLetter(tok, options)
      if (idx < 0) return []
      if (!out.includes(idx)) out.push(idx)
    }
    return out.sort((a, b) => a - b)
  }

  // compact letter runs: "AC" or "A C"
  const compact = raw.toUpperCase().replace(/\s+/g, '')
  if (/^[A-F]{2,}$/.test(compact)) {
    const out: number[] = []
    for (const ch of compact) {
      const l = LETTERS.indexOf(ch)
      if (l < 0 || l >= options.length) return []
      if (!out.includes(l)) out.push(l)
    }
    return out.sort((a, b) => a - b)
  }

  return []
}

/** Parse a plain numeric cell ("42", "42.5", "3,14") — NaN when not a number. */
function parseNum(text: string): number {
  const t = text.trim()
  if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return NaN
  return parseFloat(t.replace(',', '.'))
}

/**
 * FIB: accepted answers separated by | — the pipe is deliberately NOT in the
 * MCA split set, so answers containing commas stay intact. Deduped
 * case/whitespace-insensitively, original spelling kept for review display.
 */
export function resolveFib(correctRaw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of correctRaw.split('|')) {
    const t = part.trim()
    if (!t) continue
    const key = t.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** NUM: "42" · "42 ± 0.5" (also +-, +/-, ~) · "40..44" / "40 to 44" (midpoint ± half-width). */
export function resolveNumeric(correctRaw: string): { v: number; tol: number } | null {
  const raw = correctRaw.trim()
  if (!raw) return null
  const pm = raw.split(/±|\+\/-|\+-|~/)
  if (pm.length === 2) {
    const v = parseNum(pm[0])
    const tol = parseNum(pm[1])
    return Number.isFinite(v) && Number.isFinite(tol) ? { v, tol: Math.abs(tol) } : null
  }
  if (pm.length > 2) return null
  const range = raw.match(/^(.+?)(?:\.\.|\s+to\s+)(.+)$/i)
  if (range) {
    const a = parseNum(range[1])
    const b = parseNum(range[2])
    return Number.isFinite(a) && Number.isFinite(b) ? { v: (a + b) / 2, tol: Math.abs(b - a) / 2 } : null
  }
  const v = parseNum(raw)
  return Number.isFinite(v) ? { v, tol: 0 } : null
}

/**
 * MAT: each non-empty option cell holds one "left = right" pair (separators
 * :: -> → => also accepted, first occurrence splits). Returns aligned
 * lefts/rights or an error phrased to read after "Q<n>: ".
 */
export function parseMatchPairs(optionCells: string[]): { lefts: string[]; rights: string[]; error?: string } {
  const lefts: string[] = []
  const rights: string[] = []
  for (let i = 0; i < optionCells.length; i++) {
    const cell = optionCells[i].trim()
    if (!cell) continue
    const m = cell.match(/^(.*?)(?:::|->|→|=>|=)(.*)$/)
    const left = m ? m[1].trim() : ''
    const right = m ? m[2].trim() : ''
    if (!left || !right) return { lefts: [], rights: [], error: `option ${LETTERS[i]} needs "left = right"` }
    lefts.push(left)
    rights.push(right)
  }
  if (lefts.length < 2) return { lefts: [], rights: [], error: 'matching needs 2–6 "left = right" pairs in the option cells' }
  return { lefts, rights }
}

/**
 * SEQ: resolve the Correct Answer to the correct-order permutation, where
 * result[k] = as-listed index of the item at rank k. Blank = listed order is
 * already correct. Accepts separated letters/1-based numbers/full texts,
 * compact runs ("CADB", "3142"). Every item exactly once; [] = unresolved.
 * ORDER-PRESERVING — never reuse resolveCorrectIndexes here (it sorts).
 */
export function resolveSequence(correctRaw: string, options: string[]): number[] {
  const n = options.length
  if (n < 2) return []
  const raw = correctRaw.trim()
  if (!raw) return options.map((_, i) => i)

  const toIndex = (tok: string): number => {
    for (let i = 0; i < n; i++) if (options[i] === tok) return i
    const li = LETTERS.indexOf(tok.toUpperCase())
    if (li >= 0 && li < n) return li
    if (/^\d+$/.test(tok)) {
      const k = parseInt(tok, 10) - 1
      if (k >= 0 && k < n) return k
    }
    return -1
  }

  let tokens = raw.split(/[,;/&+]+/).map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 1 && tokens[0].length > 1) {
    const compact = raw.toUpperCase().replace(/\s+/g, '')
    if (/^[A-F]+$/.test(compact) || /^[1-6]+$/.test(compact)) tokens = compact.split('')
  }
  if (tokens.length !== n) return []

  const out: number[] = []
  const seen = new Set<number>()
  for (const tok of tokens) {
    const i = toIndex(tok)
    if (i < 0 || seen.has(i)) return []
    seen.add(i)
    out.push(i)
  }
  return out
}

export interface ParsedQuiz extends Quiz {
  /** Fatal error message when the sheet is unusable (missing columns / empty). */
  fatal?: string
}

/** Parse the first worksheet of an .xlsx/.xls/.csv ArrayBuffer into a Quiz. */
export function parseQuizWorkbook(data: ArrayBuffer, sourceName: string): ParsedQuiz {
  const empty: ParsedQuiz = { questions: [], sourceName, problems: [] }
  let rows: unknown[][]
  try {
    const wb = XLSX.read(data, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return { ...empty, fatal: 'Workbook has no sheets' }
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][]
  } catch (err) {
    return { ...empty, fatal: `Could not read spreadsheet: ${(err as Error).message}` }
  }
  if (!rows.length) return { ...empty, fatal: 'Sheet is empty' }

  const head = rows[0].map((c) => cellText(c).toLowerCase())
  const col = (key: keyof typeof HEADER_ALIASES): number => {
    const names = HEADER_ALIASES[key]
    for (let i = 0; i < head.length; i++) if (names.includes(head[i])) return i
    return -1
  }

  const cN = col('number')
  const cQ = col('question')
  const cA = col('optA')
  const cB = col('optB')
  const cC = col('optC')
  const cD = col('optD')
  const cE = col('optE')
  const cF = col('optF')
  const cCorr = col('correct')
  const cT = col('type')
  const cFb = col('feedback')
  const cFbc = col('feedbackCorrect')
  const cFbi = col('feedbackIncorrect')
  const cTol = col('tolerance')
  const cSh = col('shuffle')
  const cBank = col('bank')
  const cDraw = col('draw')

  if (cQ < 0 || cCorr < 0) {
    return { ...empty, fatal: 'Missing required columns (need Question, Option A and Correct Answer headers)' }
  }
  if (cA < 0) {
    // Option A is only dispensable when every row is a typed-answer type (FIB/NUM)
    const optionless = cT >= 0 && rows.slice(1).every((row) => {
      if (!row || cellText(row[cQ]) === '') return true
      const t = normalizeQType(cellText(row[cT]))
      return t === 'FIB' || t === 'NUM'
    })
    if (!optionless) return { ...empty, fatal: 'Missing required columns (need Question, Option A and Correct Answer headers)' }
  }

  const questions: Question[] = []
  const problems: string[] = []
  const warnings: string[] = []
  const bankLabels: (string | null)[] = [] // aligned to questions
  const drawCells: string[] = [] // aligned to questions, '' = blank

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const stem = cellText(row[cQ])
    if (stem === '') continue

    const cell = (ci: number) => (ci >= 0 ? cellText(row[ci]) : '')
    const optCells = [cA, cB, cC, cD, cE, cF].map(cell) // per-column, blanks kept (MAT letters)
    let options = optCells.filter((o) => o !== '')

    const explicit = cT >= 0 ? normalizeQType(cellText(row[cT])) : null
    // TF rows often leave the option columns blank — fill the obvious pair
    if (explicit === 'TF' && options.length < 2) options = ['True', 'False']

    const correctRaw = cell(cCorr)
    const num = cN >= 0 && cellText(row[cN]) !== '' ? (row[cN] as string | number) : questions.length + 1

    let question: Question
    if (explicit === 'FIB') {
      const a = resolveFib(correctRaw)
      if (options.length) warnings.push(`Q${num}: option cells are ignored for fill-in-the-blank`)
      if (!a.length) problems.push(`Q${num}: fill-in-the-blank needs at least one accepted answer in Correct Answer (separate alternatives with |)`)
      question = { n: num, q: stem, o: [], c: [], t: 'FIB', ...(a.length ? { a } : {}) }
    } else if (explicit === 'NUM') {
      let ans = resolveNumeric(correctRaw)
      if (!ans) problems.push(`Q${num}: numeric answer "${correctRaw || '(blank)'}" not understood — use 42, 42±0.5, or 40..44`)
      const tolRaw = cell(cTol)
      if (tolRaw !== '') {
        const tol = parseNum(tolRaw)
        if (!Number.isFinite(tol)) problems.push(`Q${num}: tolerance "${tolRaw}" is not a number`)
        else if (ans) ans = { v: ans.v, tol: Math.abs(tol) }
      }
      if (options.length) warnings.push(`Q${num}: option cells are ignored for numeric answers`)
      question = { n: num, q: stem, o: [], c: [], t: 'NUM', ...(ans ? { num: ans } : {}) }
    } else if (explicit === 'MAT') {
      const pairs = parseMatchPairs(optCells)
      if (correctRaw !== '') warnings.push(`Q${num}: Correct Answer is ignored for matching — pairs come from the option cells`)
      if (pairs.error) {
        problems.push(`Q${num}: ${pairs.error}`)
        question = { n: num, q: stem, o: [], c: [], t: 'MAT' }
      } else {
        const lowerLefts = pairs.lefts.map((l) => l.toLowerCase())
        if (new Set(lowerLefts).size !== lowerLefts.length) warnings.push(`Q${num}: duplicate left-side items in matching pairs`)
        question = { n: num, q: stem, o: pairs.lefts, c: pairs.lefts.map((_, i) => i), t: 'MAT', m: pairs.rights }
      }
    } else if (explicit === 'SEQ') {
      const order = resolveSequence(correctRaw, options)
      if (options.length < 2) problems.push(`Q${num}: sequencing needs at least 2 options`)
      else if (!order.length) problems.push(`Q${num}: sequence answer must list every option exactly once (got "${correctRaw || '(blank)'}")`)
      question = { n: num, q: stem, o: options, c: order, t: 'SEQ' }
    } else {
      // legacy choice path: MCQ/MCA/TF — unchanged behavior
      const idxs = resolveCorrectIndexes(correctRaw, options, explicit)
      const t: QType = explicit ?? (idxs.length > 1 ? 'MCA' : isTrueFalseOptions(options) ? 'TF' : 'MCQ')
      let c = idxs
      if (!idxs.length) {
        problems.push(`Q${num}: correct answer "${correctRaw || '(blank)'}" matches no option`)
      } else if (t !== 'MCA' && idxs.length > 1) {
        // declared single-answer but the sheet gives several — refuse to guess
        problems.push(`Q${num}: type ${t} but ${idxs.length} correct answers given ("${correctRaw}") — mark it MCA or fix the answer`)
        c = []
      }
      question = { n: num, q: stem, o: options, c, t }
    }

    const fb = cell(cFb)
    const fbc = cell(cFbc)
    const fbi = cell(cFbi)
    if (fb) question.fb = fb
    if (fbc) question.fbc = fbc
    if (fbi) question.fbi = fbi

    // per-row shuffle override — meaningless for TF (never shuffles) and MAT/SEQ (always seeded)
    const shRaw = cell(cSh).toLowerCase()
    if (shRaw) {
      const yes = ['yes', 'y', 'true', '1', 'on'].includes(shRaw)
      const no = ['no', 'n', 'false', '0', 'off', 'lock', 'locked'].includes(shRaw)
      if (!yes && !no) warnings.push(`Q${num}: Shuffle value "${cell(cSh)}" not recognized (use yes/no)`)
      else if (question.t === 'MCQ' || question.t === 'MCA') question.sh = yes ? 1 : 0
      else if (yes) warnings.push(`Q${num}: Shuffle is ignored for ${question.t === 'TF' ? 'true/false' : question.t === 'MAT' ? 'matching' : question.t === 'SEQ' ? 'sequencing' : 'typed-answer'} questions`)
    }

    bankLabels.push(cell(cBank) || null)
    drawCells.push(cell(cDraw))
    questions.push(question)
  }

  if (!questions.length) return { ...empty, fatal: 'No question rows found under the header row' }

  const result: ParsedQuiz = { questions, sourceName, problems }

  // bank/draw are page-level config, computed once all rows are known.
  // Misconfigurations here never make grading wrong → warnings, not problems.
  if (bankLabels.some(Boolean)) {
    const ordinals = new Map<string, number>()
    questions.forEach((q, i) => {
      const label = bankLabels[i]
      if (!label) return
      if (!ordinals.has(label)) ordinals.set(label, ordinals.size)
      q.b = ordinals.get(label)!
    })
    const bankNames = [...ordinals.keys()]
    const sizes = bankNames.map(() => 0)
    questions.forEach((q) => {
      if (q.b !== undefined) sizes[q.b]++
    })
    result.bd = bankNames.map((name, ord) => {
      // first non-empty Draw among the bank's rows wins; default 1 (a bank is a pool of variants)
      let want = 1
      for (let i = 0; i < questions.length; i++) {
        if (questions[i].b !== ord || drawCells[i] === '') continue
        const v = Number(drawCells[i])
        if (Number.isInteger(v) && v >= 1) want = v
        else warnings.push(`Bank "${name}": Draw "${drawCells[i]}" ignored — must be a whole number ≥ 1`)
        break
      }
      if (want > sizes[ord]) {
        warnings.push(`Bank "${name}": draw ${want} clamped to its ${sizes[ord]} question(s)`)
        want = sizes[ord]
      }
      return want
    })
    result.bankNames = bankNames
  } else if (cDraw >= 0) {
    const raw = drawCells.find((d) => d !== '')
    if (raw !== undefined) {
      const v = Number(raw)
      if (!Number.isInteger(v) || v < 1) warnings.push(`Draw "${raw}" ignored — must be a whole number ≥ 1`)
      else if (v >= questions.length) warnings.push(`Draw ${v} ≥ ${questions.length} questions — all questions will be shown`)
      else result.draw = v
    }
  }

  if (warnings.length) result.warnings = warnings
  return result
}
