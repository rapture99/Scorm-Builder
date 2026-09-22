import type { Block, Course, Deck, DeckBlock, DeckPage, DeckTheme, MediaRef, Question, Quiz } from './types'
import { makeAssetNamer } from './files'
import { renderRichText } from './rich'

/** Asset destined for the zip: zip-relative path + the media reference to read. */
export interface ExportAsset {
  path: string
  ref: MediaRef
}

/**
 * Question as shipped to the player. Explicit whitelist — a field missing here
 * silently never reaches the runtime, so preview and export both project
 * through this one function.
 */
function projectQuestion(q: Question): Question {
  const out: Question = { n: q.n, q: q.q, o: q.o, c: q.c, t: q.t }
  if (q.a?.length) out.a = q.a
  if (q.num) out.num = q.num
  if (q.m) out.m = q.m
  if (q.fb) out.fb = q.fb
  if (q.fbc) out.fbc = q.fbc
  if (q.fbi) out.fbi = q.fbi
  if (q.sh !== undefined) out.sh = q.sh
  if (q.b !== undefined) out.b = q.b
  return out
}

function projectQuiz(quiz: Quiz | null | undefined): DeckPage['quiz'] {
  if (!quiz?.questions?.length) return null
  const out: NonNullable<DeckPage['quiz']> = { questions: quiz.questions.map(projectQuestion) }
  if (quiz.draw) out.draw = quiz.draw
  if (quiz.bd?.length) out.bd = quiz.bd
  return out
}

/**
 * Blocks as shipped to the player: editor ids stripped, bodies rendered to
 * safe HTML, hotspot images resolved through the caller's media resolver.
 * Empty/unrenderable blocks are DROPPED here so the runtime has no empty-state
 * branches and block-less pages keep the legacy deck shape.
 */
function projectBlocks(
  blocks: Block[] | undefined,
  media: (ref: MediaRef | null | undefined) => { src: string } | null,
): DeckBlock[] | undefined {
  if (!blocks?.length) return undefined
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round((Number(n) || 0) * 10) / 10))
  const out: DeckBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'accordion' || b.kind === 'tabs') {
      const items = b.items
        .filter((it) => it.title.trim() || it.body.trim())
        .map((it) => ({ title: it.title, bodyHtml: renderRichText(it.body) }))
      if (items.length) out.push({ kind: b.kind, items })
    } else if (b.kind === 'flashcards') {
      const cards = b.cards
        .filter((c) => c.front.trim() || c.back.trim())
        .map((c) => ({ frontHtml: renderRichText(c.front), backHtml: renderRichText(c.back) }))
      if (cards.length) out.push({ kind: 'flashcards', cards })
    } else if (b.kind === 'reveal') {
      if (b.body.trim()) out.push({ kind: 'reveal', prompt: b.prompt.trim() || 'Reveal', bodyHtml: renderRichText(b.body) })
    } else if (b.kind === 'timeline') {
      const items = b.items
        .filter((it) => it.label.trim() || it.title.trim() || it.body.trim())
        .map((it) => ({ label: it.label, title: it.title, bodyHtml: renderRichText(it.body) }))
      if (items.length) out.push({ kind: 'timeline', items })
    } else if (b.kind === 'hotspots') {
      const image = media(b.image)
      const spots = b.spots.map((s) => ({ x: pct(s.x), y: pct(s.y), title: s.title, bodyHtml: renderRichText(s.body) }))
      if (image && spots.length) out.push({ kind: 'hotspots', image, spots })
    }
  }
  return out.length ? out : undefined
}

/** Course-level runtime settings — kept absent when off so the deck JSON stays small. */
function deckSettings(course: Course, theme?: DeckTheme | null): Partial<Deck> {
  const out: Partial<Deck> = {}
  if (course.maxAttempts && course.maxAttempts > 0) out.maxAttempts = course.maxAttempts
  if (course.shuffleQuestions || course.shuffleOptions) {
    out.shuffle = {
      ...(course.shuffleQuestions ? { q: 1 as const } : {}),
      ...(course.shuffleOptions ? { o: 1 as const } : {}),
    }
  }
  if (theme) out.theme = theme
  if (course.navMode === 'restricted') out.navMode = 'restricted'
  // resolved to an index; a deleted target simply drops the field (button never shows)
  const fi = course.pages.findIndex((p) => p.id === course.onFailPageId)
  if (fi >= 0) out.onFailPage = fi
  return out
}

/** Build the deck with media rewritten to packaged assets/ paths. */
export function buildExportDeck(course: Course, theme?: DeckTheme | null): { deck: Deck; assets: ExportAsset[] } {
  const claim = makeAssetNamer()
  const assets: ExportAsset[] = []
  const media = (ref: MediaRef | null | undefined, pageIndex: number) => {
    if (!ref) return null
    const path = `assets/${claim(`p${pageIndex + 1}_${ref.name}`)}`
    assets.push({ path, ref })
    return { src: path }
  }
  const deck: Deck = {
    title: course.title || 'Untitled Course',
    passMark: course.passMark,
    scormVersion: course.scormVersion,
    ...deckSettings(course, theme),
    pages: course.pages.map((p, i) => {
      const blocks = projectBlocks(p.blocks, (r) => media(r, i))
      return {
        title: p.title || '',
        bodyHtml: renderRichText(p.body || ''),
        // captions only ship alongside a video — no video, no asset claimed
        video: p.video
          ? { ...media(p.video, i)!, ...(p.captions ? { captions: media(p.captions, i)!.src } : {}) }
          : null,
        image: media(p.image, i),
        audio: media(p.audio, i),
        doc: p.doc ? { ...media(p.doc, i)!, name: p.doc.name } : null,
        ...(blocks ? { blocks } : {}),
        quiz: projectQuiz(p.quiz),
      }
    }),
  }
  return { deck, assets }
}

/** Build the deck with media rewritten to live URLs (object URLs) for preview. */
export function buildPreviewDeck(course: Course, urlFor: (ref: MediaRef) => string, theme?: DeckTheme | null): Deck {
  return {
    title: course.title || 'Untitled Course',
    passMark: course.passMark,
    scormVersion: course.scormVersion,
    ...deckSettings(course, theme),
    pages: course.pages.map((p) => {
      const blocks = projectBlocks(p.blocks, (r) => (r ? { src: urlFor(r) } : null))
      return {
        title: p.title || '',
        bodyHtml: renderRichText(p.body || ''),
        video: p.video
          ? { src: urlFor(p.video), ...(p.captions ? { captions: urlFor(p.captions) } : {}) }
          : null,
        image: p.image ? { src: urlFor(p.image) } : null,
        audio: p.audio ? { src: urlFor(p.audio) } : null,
        doc: p.doc ? { src: urlFor(p.doc), name: p.doc.name } : null,
        ...(blocks ? { blocks } : {}),
        quiz: projectQuiz(p.quiz),
      }
    }),
  }
}
