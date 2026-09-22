/** Core data model. Media blobs live in IndexedDB; pages hold references only. */

export type ScormVersion = '1.2' | '2004'

export interface Course {
  title: string
  passMark: number
  scormVersion: ScormVersion
  pages: Page[]
  /** Graded submissions allowed per learner; 0/undefined = unlimited. */
  maxAttempts?: number
  /** Present quiz questions in a random order (re-rolled per attempt). */
  shuffleQuestions?: boolean
  /** Present MCQ/MCA options in a random order (TF never shuffles; per-question `sh` overrides). */
  shuffleOptions?: boolean
  /** Player look. Absent/null = the built-in dark theme, byte-identical output. */
  theme?: CourseTheme | null
  /** 'restricted' gates Next + forward dots until each page is finished. Absent/'free' = today's behavior. */
  navMode?: 'free' | 'restricted'
  /** Page to offer as "Review the material" after a failed graded attempt. */
  onFailPageId?: string
}

/** Player branding. `logo` is a MediaRef like page media so GC keeps the blob alive. */
export interface CourseTheme {
  scheme: 'dark' | 'light'
  /** Accent color, '#rrggbb'. */
  primary: string
  font: 'sans' | 'serif' | 'mono'
  logo?: MediaRef | null
}

export interface Page {
  id: string
  title: string
  body: string
  video?: MediaRef | null
  image?: MediaRef | null
  audio?: MediaRef | null
  doc?: MediaRef | null
  /** WebVTT captions for this page's video (SRT converts on attach). */
  captions?: MediaRef | null
  quiz?: Quiz | null
  /** Ordered interactive content blocks, rendered between body text and media. Absent on legacy saves. */
  blocks?: Block[]
}

/**
 * Interactive content blocks (Rise-style). `id`s exist for React keys and are
 * stripped at deck projection. All `body`/`front`/`back` fields are
 * markdown-subset source rendered via renderRichText at deck-build time.
 * Blocks are presentation-only: they never gate completion and never touch
 * suspend_data.
 */
export type Block =
  | { id: string; kind: 'accordion'; items: BlockItem[] }
  | { id: string; kind: 'tabs'; items: BlockItem[] }
  | { id: string; kind: 'flashcards'; cards: { id: string; front: string; back: string }[] }
  | { id: string; kind: 'reveal'; prompt: string; body: string }
  | { id: string; kind: 'timeline'; items: { id: string; label: string; title: string; body: string }[] }
  | {
      id: string
      kind: 'hotspots'
      image: MediaRef | null
      /** x/y are percentages (0–100) of the image box, so markers track responsive scaling. */
      spots: { id: string; x: number; y: number; title: string; body: string }[]
    }

export interface BlockItem {
  id: string
  title: string
  body: string
}

export type BlockKind = Block['kind']
export const BLOCK_KINDS: readonly BlockKind[] = ['accordion', 'tabs', 'flashcards', 'reveal', 'timeline', 'hotspots']

/** Media refs carried INSIDE a block — the only place that knows which kinds hold media. */
export function blockMediaRefs(b: Block): MediaRef[] {
  return b.kind === 'hotspots' && b.image ? [b.image] : []
}

/**
 * Every media kind a page can hold. The single registry that GC
 * (db.referencedMediaIds), preview URLs and deck building key on — add a kind
 * here and to Page, and all of those pick it up.
 */
export const PAGE_MEDIA_KINDS = ['video', 'image', 'audio', 'doc', 'captions'] as const
export type PageMediaKind = (typeof PAGE_MEDIA_KINDS)[number]

export function pageMediaRefs(p: Page): MediaRef[] {
  const out: MediaRef[] = []
  for (const k of PAGE_MEDIA_KINDS) {
    const r = p[k]
    if (r) out.push(r)
  }
  for (const b of p.blocks ?? []) out.push(...blockMediaRefs(b))
  return out
}

/** Page refs plus course-level refs (theme logo) — everything GC must keep alive. */
export function courseMediaRefs(course: Course): MediaRef[] {
  const out = course.pages.flatMap(pageMediaRefs)
  if (course.theme?.logo) out.push(course.theme.logo)
  return out
}

/** Reference to a blob stored in IndexedDB under `mediaId`. */
export interface MediaRef {
  mediaId: string
  name: string
  size: number
  type: string
}

export interface Quiz {
  questions: Question[]
  sourceName: string
  /** Human-readable descriptions of unscorable rows. Any entry blocks export. */
  problems: string[]
  /** Non-blocking authoring notes (ignored cells, clamped draws, …). */
  warnings?: string[]
  /** Bankless random draw: show N of the M questions (1 ≤ N < M). */
  draw?: number
  /** Banks mode: per-bank draw counts indexed by bank ordinal (see Question.b). */
  bd?: number[]
  /** Bank labels by ordinal — editor display only, never exported to the deck. */
  bankNames?: string[]
}

/**
 * MCQ = single choice (radio) · MCA = multiple correct answers (checkboxes, all-or-nothing) ·
 * TF = true/false (radio) · FIB = fill in the blank (typed text) · NUM = numeric entry ·
 * MAT = match left↔right pairs · SEQ = put items in the correct order.
 */
export type QType = 'MCQ' | 'MCA' | 'TF' | 'FIB' | 'NUM' | 'MAT' | 'SEQ'

export interface Question {
  n: string | number
  q: string
  /** Choices. MAT: left items. SEQ: items in as-listed order. Empty for FIB/NUM. */
  o: string[]
  /**
   * Correct option indexes, sorted; [] = unresolved (blocks export) — except:
   * SEQ stores the correct-order permutation (unsorted), MAT stores identity 0..n-1,
   * FIB/NUM store [] and carry their answer in `a`/`num` instead.
   */
  c: number[]
  t: QType
  /** FIB: accepted answers — any one matches (case/whitespace-insensitive). */
  a?: string[]
  /** NUM: expected value ± tolerance. */
  num?: { v: number; tol: number }
  /** MAT: right-side items aligned to `o` by index. */
  m?: string[]
  /** Feedback shown after grading; fbc/fbi (when correct/incorrect) win over fb. */
  fb?: string
  fbc?: string
  fbi?: string
  /** Option-shuffle override: 1 = always shuffle, 0 = never; unset = course setting. */
  sh?: 0 | 1
  /** Bank ordinal this question belongs to (see Quiz.bd). */
  b?: number
}

/** Deck = what the exported player consumes. Media resolved to src paths/URLs. */
export interface Deck {
  title: string
  passMark: number
  /** Tells the player runtime which LMS API to bind (API vs API_1484_11) and which cmi keys to write. */
  scormVersion: ScormVersion
  pages: DeckPage[]
  maxAttempts?: number
  /** Course-level shuffle flags: q = question order, o = option order. Absent = off. */
  shuffle?: { q?: 1; o?: 1 }
  theme?: DeckTheme | null
  /** Present only when restricted — the player gates Next/forward dots on page readiness. */
  navMode?: 'restricted'
  /** Resolved page INDEX for the post-fail "Review the material" jump; absent if unset/deleted. */
  onFailPage?: number
}

/** Theme as shipped inside the deck JSON — logo already resolved to a data URI. */
export interface DeckTheme {
  scheme: 'dark' | 'light'
  primary: string
  font: 'sans' | 'serif' | 'mono'
  logoDataUri?: string
}

export interface DeckPage {
  title: string
  /** Renderer-produced safe HTML (renderRichText) — the player injects it unescaped. */
  bodyHtml: string
  video?: { src: string; captions?: string } | null
  image?: { src: string } | null
  audio?: { src: string } | null
  doc?: { src: string; name: string } | null
  quiz?: { questions: Question[]; draw?: number; bd?: number[] } | null
  /** Blocks as shipped: bodies pre-rendered, media resolved, no editor ids. Key absent when none. */
  blocks?: DeckBlock[]
}

export type DeckBlock =
  | { kind: 'accordion'; items: { title: string; bodyHtml: string }[] }
  | { kind: 'tabs'; items: { title: string; bodyHtml: string }[] }
  | { kind: 'flashcards'; cards: { frontHtml: string; backHtml: string }[] }
  | { kind: 'reveal'; prompt: string; bodyHtml: string }
  | { kind: 'timeline'; items: { label: string; title: string; bodyHtml: string }[] }
  | { kind: 'hotspots'; image: { src: string }; spots: { x: number; y: number; title: string; bodyHtml: string }[] }
