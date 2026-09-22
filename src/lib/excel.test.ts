import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  resolveCorrectIndexes, parseQuizWorkbook, normalizeQType, isTrueFalseOptions,
  resolveFib, resolveNumeric, parseMatchPairs, resolveSequence,
} from './excel'

function sheetBuffer(rows: (string | number | boolean | null)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Quiz')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('resolveCorrectIndexes — the resolution order the runtime depends on', () => {
  const opts = ['Paris', 'London', 'Berlin', 'Madrid']

  it('matches exact full text first', () => {
    expect(resolveCorrectIndexes('London', opts)).toEqual([1])
  })

  it('trims whitespace before matching', () => {
    expect(resolveCorrectIndexes('  Berlin  ', opts)).toEqual([2])
  })

  it('falls back to letter A–D when no full-text match', () => {
    expect(resolveCorrectIndexes('C', opts)).toEqual([2])
    expect(resolveCorrectIndexes('a', opts)).toEqual([0]) // case-insensitive letter
  })

  it('exact text beats letter semantics when an option IS a letter', () => {
    expect(resolveCorrectIndexes('A', ['True', 'A', 'False'])).toEqual([1])
  })

  it('letter beyond the option count does not resolve', () => {
    expect(resolveCorrectIndexes('D', ['yes', 'no'])).toEqual([])
  })

  it('returns [] for blank or unmatched values', () => {
    expect(resolveCorrectIndexes('', opts)).toEqual([])
    expect(resolveCorrectIndexes('Rome', opts)).toEqual([])
    expect(resolveCorrectIndexes('E', opts)).toEqual([])
  })

  it('never resolves by substring or case-insensitive full text', () => {
    expect(resolveCorrectIndexes('paris', opts)).toEqual([])
    expect(resolveCorrectIndexes('Lond', opts)).toEqual([])
  })

  describe('multiple correct answers (MCA)', () => {
    it('resolves comma-separated letters, sorted', () => {
      expect(resolveCorrectIndexes('C, A', opts)).toEqual([0, 2])
      expect(resolveCorrectIndexes('A;D', opts)).toEqual([0, 3])
    })

    it('resolves comma-separated full texts', () => {
      expect(resolveCorrectIndexes('Paris, Berlin', opts)).toEqual([0, 2])
    })

    it('mixes text and letters', () => {
      expect(resolveCorrectIndexes('Paris, D', opts)).toEqual([0, 3])
    })

    it('resolves compact letter runs "AC" and "A C"', () => {
      expect(resolveCorrectIndexes('AC', opts)).toEqual([0, 2])
      expect(resolveCorrectIndexes('B D', opts)).toEqual([1, 3])
    })

    it('exact full-cell match wins over separator splitting (option text containing a comma)', () => {
      const withComma = ['Slow down, then stop', 'Speed up']
      expect(resolveCorrectIndexes('Slow down, then stop', withComma)).toEqual([0])
    })

    it('fails the WHOLE cell when any token is unresolvable', () => {
      expect(resolveCorrectIndexes('A, Rome', opts)).toEqual([])
    })

    it('dedupes repeated tokens', () => {
      expect(resolveCorrectIndexes('A, A, C', opts)).toEqual([0, 2])
    })
  })

  describe('true/false tolerance', () => {
    const tf = ['True', 'False']

    it('matches case-insensitively for TF options', () => {
      expect(resolveCorrectIndexes('TRUE', tf)).toEqual([0])
      expect(resolveCorrectIndexes('false', tf)).toEqual([1])
    })

    it('accepts T/F shortcuts', () => {
      expect(resolveCorrectIndexes('T', tf)).toEqual([0])
      expect(resolveCorrectIndexes('f', tf)).toEqual([1])
    })

    it('handles Excel boolean cells (stringified lowercase)', () => {
      expect(resolveCorrectIndexes('true', ['TRUE', 'FALSE'], 'TF')).toEqual([0])
    })
  })
})

describe('normalizeQType', () => {
  it('recognizes MCA spellings without hijacking "Multiple Choice"', () => {
    expect(normalizeQType('MCA')).toBe('MCA')
    expect(normalizeQType('Multi-select')).toBe('MCA')
    expect(normalizeQType('Multiple Correct')).toBe('MCA')
    expect(normalizeQType('multiple response')).toBe('MCA')
    expect(normalizeQType('Multiple Choice')).toBe('MCQ')
    expect(normalizeQType('MCQ')).toBe('MCQ')
  })

  it('recognizes true/false spellings', () => {
    expect(normalizeQType('T/F')).toBe('TF')
    expect(normalizeQType('True/False')).toBe('TF')
    expect(normalizeQType('true or false')).toBe('TF')
  })

  it('returns null for blank or unknown (→ inference)', () => {
    expect(normalizeQType('')).toBeNull()
    expect(normalizeQType('essay')).toBeNull()
  })

  it('recognizes the new declared-only types', () => {
    expect(normalizeQType('FIB')).toBe('FIB')
    expect(normalizeQType('Fill in the blank')).toBe('FIB')
    expect(normalizeQType('Short Answer')).toBe('FIB')
    expect(normalizeQType('Text Entry')).toBe('FIB')
    expect(normalizeQType('Numeric')).toBe('NUM')
    expect(normalizeQType('Number')).toBe('NUM')
    expect(normalizeQType('Matching')).toBe('MAT')
    expect(normalizeQType('Match the following')).toBe('MAT')
    expect(normalizeQType('Pairs')).toBe('MAT')
    expect(normalizeQType('Sequencing')).toBe('SEQ')
    expect(normalizeQType('Ordering')).toBe('SEQ')
    expect(normalizeQType('Put in order')).toBe('SEQ')
    expect(normalizeQType('Arrange')).toBe('SEQ')
    // and none of them hijack the existing keyword sets
    expect(normalizeQType('Multiple Choice')).toBe('MCQ')
    expect(normalizeQType('Multiple Response')).toBe('MCA')
    expect(normalizeQType('True/False')).toBe('TF')
  })
})

describe('resolveFib', () => {
  it('splits accepted answers on | keeping commas intact', () => {
    expect(resolveFib('speed|her speed')).toEqual(['speed', 'her speed'])
    expect(resolveFib('slow down, then stop')).toEqual(['slow down, then stop'])
  })
  it('trims, drops empties and dedupes case/whitespace-insensitively', () => {
    expect(resolveFib(' speed |  | SPEED | her  speed ')).toEqual(['speed', 'her  speed'])
    expect(resolveFib('')).toEqual([])
    expect(resolveFib(' | ')).toEqual([])
  })
})

describe('resolveNumeric', () => {
  it('parses plain numbers, decimal commas included', () => {
    expect(resolveNumeric('225')).toEqual({ v: 225, tol: 0 })
    expect(resolveNumeric('-4.5')).toEqual({ v: -4.5, tol: 0 })
    expect(resolveNumeric('3,14')).toEqual({ v: 3.14, tol: 0 })
  })
  it('parses value ± tolerance in all spellings', () => {
    expect(resolveNumeric('42 ± 0.5')).toEqual({ v: 42, tol: 0.5 })
    expect(resolveNumeric('42 +- 0.5')).toEqual({ v: 42, tol: 0.5 })
    expect(resolveNumeric('42+/-0.5')).toEqual({ v: 42, tol: 0.5 })
    expect(resolveNumeric('42 ~ 0.5')).toEqual({ v: 42, tol: 0.5 })
  })
  it('parses ranges as midpoint ± half-width', () => {
    expect(resolveNumeric('40..44')).toEqual({ v: 42, tol: 2 })
    expect(resolveNumeric('40 to 44')).toEqual({ v: 42, tol: 2 })
    expect(resolveNumeric('44 to 40')).toEqual({ v: 42, tol: 2 })
    expect(resolveNumeric('40.5..44.5')).toEqual({ v: 42.5, tol: 2 })
  })
  it('returns null for blanks and garbage', () => {
    expect(resolveNumeric('')).toBeNull()
    expect(resolveNumeric('fast')).toBeNull()
    expect(resolveNumeric('40..x')).toBeNull()
    expect(resolveNumeric('1 ± 2 ± 3')).toBeNull()
  })
})

describe('parseMatchPairs', () => {
  it('splits each cell on the first separator, any spelling', () => {
    const r = parseMatchPairs(['Port = Left side', 'Starboard -> Right side', 'Bow :: Front', 'Stern => Back', '', ''])
    expect(r.error).toBeUndefined()
    expect(r.lefts).toEqual(['Port', 'Starboard', 'Bow', 'Stern'])
    expect(r.rights).toEqual(['Left side', 'Right side', 'Front', 'Back'])
  })
  it('an equals inside the right side stays intact (first separator wins)', () => {
    const r = parseMatchPairs(['a = b = c', 'x = y', '', '', '', ''])
    expect(r.rights).toEqual(['b = c', 'y'])
  })
  it('names the offending cell letter when a side is blank', () => {
    expect(parseMatchPairs(['Port = Left', 'Starboard =', '', '', '', '']).error).toContain('option B')
    expect(parseMatchPairs(['no separator here', 'x = y', '', '', '', '']).error).toContain('option A')
  })
  it('requires at least two pairs', () => {
    expect(parseMatchPairs(['Port = Left', '', '', '', '', '']).error).toMatch(/2–6/)
  })
})

describe('resolveSequence — order-preserving, never sorted', () => {
  const opts = ['Reduce speed', 'Sound signal', 'Post lookout', 'Log the event']

  it('resolves separated letters in the GIVEN order', () => {
    expect(resolveSequence('C, B, A, D', opts)).toEqual([2, 1, 0, 3])
  })
  it('resolves compact letter and digit runs', () => {
    expect(resolveSequence('CADB', opts)).toEqual([2, 0, 3, 1])
    expect(resolveSequence('3142', opts)).toEqual([2, 0, 3, 1])
  })
  it('resolves 1-based numbers and full texts', () => {
    expect(resolveSequence('3;1;4;2', opts)).toEqual([2, 0, 3, 1])
    expect(resolveSequence('Post lookout, Reduce speed, Log the event, Sound signal', opts)).toEqual([2, 0, 3, 1])
  })
  it('blank means the listed order is correct', () => {
    expect(resolveSequence('', opts)).toEqual([0, 1, 2, 3])
  })
  it('rejects wrong counts, repeats and unknown items', () => {
    expect(resolveSequence('C, B, A', opts)).toEqual([])
    expect(resolveSequence('A, A, B, C', opts)).toEqual([])
    expect(resolveSequence('A, B, C, X', opts)).toEqual([])
    expect(resolveSequence('AB', ['only one'])).toEqual([])
  })
})

describe('isTrueFalseOptions', () => {
  it('detects a true/false pair regardless of case and order', () => {
    expect(isTrueFalseOptions(['True', 'False'])).toBe(true)
    expect(isTrueFalseOptions(['FALSE', 'TRUE'])).toBe(true)
    expect(isTrueFalseOptions(['True', 'False', 'Maybe'])).toBe(false)
    expect(isTrueFalseOptions(['Yes', 'No'])).toBe(false)
  })
})

describe('parseQuizWorkbook', () => {
  it('parses a standard sheet and resolves answers to integer index arrays', () => {
    const buf = sheetBuffer([
      ['Number', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Question Type'],
      [1, 'Capital of France?', 'Paris', 'London', 'Berlin', 'Madrid', 'Paris', 'MCQ'],
      [2, '2 + 2 = ?', '3', '4', '5', '6', 'B', 'MCQ'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.fatal).toBeUndefined()
    expect(q.questions).toHaveLength(2)
    expect(q.questions[0].c).toEqual([0])
    expect(q.questions[1].c).toEqual([1])
    expect(q.questions[0].t).toBe('MCQ')
    expect(q.problems).toHaveLength(0)
  })

  it('parses MCA rows with multiple correct answers', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Question Type'],
      ['Which are vessels constrained by draught signals?', 'Cylinder', 'Three red lights', 'One black ball', 'Two cones', 'A, B', 'MCA'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.problems).toHaveLength(0)
    expect(q.questions[0].t).toBe('MCA')
    expect(q.questions[0].c).toEqual([0, 1])
  })

  it('infers MCA from a multi-answer cell when no type column exists', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Correct Answer'],
      ['Pick two', 'x', 'y', 'z', 'A, C'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].t).toBe('MCA')
    expect(q.questions[0].c).toEqual([0, 2])
    expect(q.problems).toHaveLength(0)
  })

  it('parses TF rows with blank option columns by auto-filling True/False', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Question Type'],
      ['A stand-on vessel keeps course and speed', null, null, 'True', 'T/F'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.problems).toHaveLength(0)
    expect(q.questions[0].t).toBe('TF')
    expect(q.questions[0].o).toEqual(['True', 'False'])
    expect(q.questions[0].c).toEqual([0])
  })

  it('infers TF from True/False options without a type column', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer'],
      ['Rule 5 requires a proper lookout', 'True', 'False', 'true'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].t).toBe('TF')
    expect(q.questions[0].c).toEqual([0])
  })

  it('flags a declared MCQ that lists several correct answers instead of guessing', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Correct Answer', 'Question Type'],
      ['Conflicted row', 'x', 'y', 'z', 'A, B', 'MCQ'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].c).toEqual([])
    expect(q.problems).toHaveLength(1)
    expect(q.problems[0]).toContain('MCQ')
    expect(q.problems[0]).toContain('mark it MCA')
  })

  it('tolerates header variants', () => {
    const buf = sheetBuffer([
      ['sr no', 'stem', 'a', 'b', 'c', 'd', 'key'],
      [7, 'Pick one', 'x', 'y', 'z', 'w', 'y'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.fatal).toBeUndefined()
    expect(q.questions).toHaveLength(1)
    expect(q.questions[0].n).toBe(7)
    expect(q.questions[0].c).toEqual([1])
  })

  it('flags unresolvable answers as problems naming the question', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer'],
      ['Good row', 'yes', 'no', 'yes'],
      ['Bad row', 'yes', 'no', 'maybe'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions).toHaveLength(2)
    expect(q.questions[1].c).toEqual([])
    expect(q.problems).toHaveLength(1)
    expect(q.problems[0]).toContain('Q2')
    expect(q.problems[0]).toContain('maybe')
  })

  it('fails loudly when required columns are missing', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B'], // no Correct Answer column
      ['Q', 'a', 'b'],
    ])
    expect(parseQuizWorkbook(buf, 'quiz.xlsx').fatal).toMatch(/Correct Answer/)
  })

  it('skips rows with an empty question cell', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer'],
      ['Real question', 'a', 'b', 'a'],
      ['', 'x', 'y', 'x'],
    ])
    expect(parseQuizWorkbook(buf, 'quiz.xlsx').questions).toHaveLength(1)
  })

  it('handles numeric option cells (Excel numbers) via string coercion', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer'],
      ['Pick 4', 3, 4, 4],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].c).toEqual([1])
  })

  it('handles Excel boolean TRUE/FALSE cells in a TF row', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Type'],
      ['Boolean cells', true, false, true, 'TF'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.problems).toHaveLength(0)
    expect(q.questions[0].c).toEqual([0])
  })

  it('GOLDEN: a legacy 7-column sheet parses to exactly the legacy shape — no new keys', () => {
    const buf = sheetBuffer([
      ['Number', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Question Type'],
      [1, 'Capital of France?', 'Paris', 'London', 'Berlin', 'Madrid', 'Paris', 'MCQ'],
      [2, 'Pick two', 'w', 'x', 'y', 'z', 'A, C', 'MCA'],
      [3, 'Broken row', 'a', 'b', 'c', 'd', 'nope', ''],
    ])
    const q = parseQuizWorkbook(buf, 'A_005.xlsx')
    expect(q).toEqual({
      sourceName: 'A_005.xlsx',
      problems: ['Q3: correct answer "nope" matches no option'],
      questions: [
        { n: 1, q: 'Capital of France?', o: ['Paris', 'London', 'Berlin', 'Madrid'], c: [0], t: 'MCQ' },
        { n: 2, q: 'Pick two', o: ['w', 'x', 'y', 'z'], c: [0, 2], t: 'MCA' },
        { n: 3, q: 'Broken row', o: ['a', 'b', 'c', 'd'], c: [], t: 'MCQ' },
      ],
    })
    expect(Object.keys(q.questions[0])).toEqual(['n', 'q', 'o', 'c', 't'])
    expect('warnings' in q).toBe(false)
  })

  it('supports options E and F, letters included', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Correct Answer'],
      ['Pick the sixth', 'a', 'b', 'c', 'd', 'e', 'f', 'F'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].o).toHaveLength(6)
    expect(q.questions[0].c).toEqual([5])
  })

  it('parses FIB rows: accepted answers, warnings for filled options, problem when blank', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Correct Answer', 'Question Type'],
      ['The stand-on vessel keeps course and ___', '', 'speed|her speed', 'Fill in the blank'],
      ['Ignored options here', 'stray', 'speed', 'FIB'],
      ['No answer given', '', '', 'FIB'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0]).toMatchObject({ t: 'FIB', o: [], c: [], a: ['speed', 'her speed'] })
    expect(q.warnings).toEqual([expect.stringContaining('Q2: option cells are ignored')])
    expect(q.problems).toEqual([expect.stringContaining('Q3: fill-in-the-blank needs at least one accepted answer')])
  })

  it('a FIB/NUM-only sheet does not need an Option A column', () => {
    const buf = sheetBuffer([
      ['Question', 'Correct Answer', 'Question Type'],
      ['Blank me', 'speed', 'FIB'],
      ['Count me', '42', 'Numeric'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.fatal).toBeUndefined()
    expect(q.questions).toHaveLength(2)
  })

  it('parses NUM rows with the Tolerance column overriding the cell', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Correct Answer', 'Tolerance', 'Question Type'],
      ['Arc of masthead light?', '', 225, '', 'Numeric'],
      ['Safe CPA?', '', '1.5 ± 0.1', 0.5, 'NUM'],
      ['Bad tolerance', '', 10, 'ish', 'NUM'],
      ['Not a number', '', 'fast', '', 'NUM'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].num).toEqual({ v: 225, tol: 0 })
    expect(q.questions[1].num).toEqual({ v: 1.5, tol: 0.5 })
    expect(q.problems).toEqual([
      expect.stringContaining('Q3: tolerance "ish" is not a number'),
      expect.stringContaining('Q4: numeric answer "fast" not understood'),
    ])
  })

  it('parses MAT rows from "left = right" option cells', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Correct Answer', 'Question Type'],
      ['Match terms', 'Port = Left side', 'Starboard = Right side', 'Bow = Front', 'ignored', 'Matching'],
      ['Bad pair', 'Port = Left', 'Starboard =', '', '', 'Matching'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0]).toMatchObject({
      t: 'MAT',
      o: ['Port', 'Starboard', 'Bow'],
      m: ['Left side', 'Right side', 'Front'],
      c: [0, 1, 2],
    })
    expect(q.warnings).toEqual([expect.stringContaining('Q1: Correct Answer is ignored for matching')])
    expect(q.problems).toEqual([expect.stringContaining('Q2: option B needs')])
  })

  it('parses SEQ rows, preserving the answer order', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Question Type'],
      ['Order the actions', 'Reduce speed', 'Sound signal', 'Post lookout', 'Log it', 'C, B, A, D', 'Sequencing'],
      ['Wrong count', 'x', 'y', 'z', '', 'A, B', 'SEQ'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0]).toMatchObject({ t: 'SEQ', c: [2, 1, 0, 3] })
    expect(q.problems).toEqual([expect.stringContaining('Q2: sequence answer must list every option exactly once')])
  })

  it('attaches feedback columns to any question type', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Feedback', 'Correct Feedback', 'Incorrect Feedback'],
      ['Pick a', 'a', 'b', 'a', 'general note', 'well done', 'see Rule 17'],
      ['Pick b', 'a', 'b', 'b', '', '', ''],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0]).toMatchObject({ fb: 'general note', fbc: 'well done', fbi: 'see Rule 17' })
    expect('fb' in q.questions[1]).toBe(false)
  })

  it('reads the per-row Shuffle override, warning on nonsense and TF', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Question Type', 'Shuffle'],
      ['Shuffled', 'a', 'b', 'a', 'MCQ', 'yes'],
      ['Locked', 'a', 'b', 'a', 'MCQ', 'no'],
      ['Follows course', 'a', 'b', 'a', 'MCQ', ''],
      ['Nonsense', 'a', 'b', 'a', 'MCQ', 'maybe'],
      ['TF never shuffles', 'True', 'False', 'True', 'TF', 'yes'],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.questions[0].sh).toBe(1)
    expect(q.questions[1].sh).toBe(0)
    expect(q.questions[2].sh).toBeUndefined()
    expect(q.questions[4].sh).toBeUndefined()
    expect(q.warnings).toEqual([
      expect.stringContaining('Q4: Shuffle value "maybe" not recognized'),
      expect.stringContaining('Q5: Shuffle is ignored for true/false'),
    ])
  })

  it('bankless Draw shows N of M, clamping out-of-range values to a warning', () => {
    const rows = (draw: string | number) => sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Draw'],
      ['q1', 'a', 'b', 'a', draw],
      ['q2', 'a', 'b', 'a', ''],
      ['q3', 'a', 'b', 'a', ''],
    ])
    expect(parseQuizWorkbook(rows(2), 'q.xlsx').draw).toBe(2)
    const tooBig = parseQuizWorkbook(rows(5), 'q.xlsx')
    expect(tooBig.draw).toBeUndefined()
    expect(tooBig.warnings).toEqual([expect.stringContaining('Draw 5 ≥ 3 questions')])
    const junk = parseQuizWorkbook(rows('lots'), 'q.xlsx')
    expect(junk.draw).toBeUndefined()
    expect(junk.warnings).toEqual([expect.stringContaining('Draw "lots" ignored')])
  })

  it('Bank labels group questions into pools with per-bank draws (default 1)', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Bank', 'Draw'],
      ['e1', 'a', 'b', 'a', 'Easy', 2],
      ['e2', 'a', 'b', 'a', 'Easy', ''],
      ['e3', 'a', 'b', 'a', 'Easy', ''],
      ['h1', 'a', 'b', 'a', 'Hard', ''],
      ['h2', 'a', 'b', 'a', 'Hard', ''],
      ['always', 'a', 'b', 'a', '', ''],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.bankNames).toEqual(['Easy', 'Hard'])
    expect(q.bd).toEqual([2, 1])
    expect(q.questions.map((x) => x.b)).toEqual([0, 0, 0, 1, 1, undefined])
    expect(q.draw).toBeUndefined()
  })

  it('clamps a per-bank draw larger than the bank', () => {
    const buf = sheetBuffer([
      ['Question', 'Option A', 'Option B', 'Correct Answer', 'Bank', 'Draw'],
      ['e1', 'a', 'b', 'a', 'Easy', 9],
      ['e2', 'a', 'b', 'a', 'Easy', ''],
    ])
    const q = parseQuizWorkbook(buf, 'quiz.xlsx')
    expect(q.bd).toEqual([2])
    expect(q.warnings).toEqual([expect.stringContaining('Bank "Easy": draw 9 clamped to its 2 question(s)')])
  })
})
