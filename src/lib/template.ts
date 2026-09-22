import { PAGE_MEDIA_KINDS, type Course, type PageMediaKind } from './types'

/**
 * Course templates: the full structure (pages, quizzes, blocks, settings,
 * theme) as a downloadable JSON file — with every media blob STRIPPED. A
 * MediaRef whose blob is absent would poison preview/export (getMediaByRef
 * throws) and GC, so refs are removed and recorded in a manifest the loader
 * can toast ("re-attach R_005.mp4, page 1 video"). Full media backup is a
 * deliberate non-goal here (would need a zip container, not JSON).
 */

export const TEMPLATE_VERSION = 1

export interface TemplateMediaNote {
  /** 1-based page number; 0 = course-level (theme logo). */
  page: number
  kind: PageMediaKind | 'hotspot' | 'logo'
  name: string
}

export interface TemplateEnvelope {
  app: 'norm-scorm-builder'
  kind: 'template'
  version: number
  /** What was attached when the template was saved — the loader lists these to re-attach. */
  media: TemplateMediaNote[]
  course: Course
}

export function serializeTemplate(course: Course): TemplateEnvelope {
  // Course is plain JSON by construction (reducer state) — a JSON deep copy is exact
  const copy: Course = JSON.parse(JSON.stringify(course))
  const media: TemplateMediaNote[] = []
  copy.pages.forEach((p, i) => {
    for (const k of PAGE_MEDIA_KINDS) {
      const ref = p[k]
      if (ref) {
        media.push({ page: i + 1, kind: k, name: ref.name })
        p[k] = null
      }
    }
    for (const b of p.blocks ?? []) {
      if (b.kind === 'hotspots' && b.image) {
        media.push({ page: i + 1, kind: 'hotspot', name: b.image.name })
        b.image = null
      }
    }
  })
  if (copy.theme?.logo) {
    media.push({ page: 0, kind: 'logo', name: copy.theme.logo.name })
    copy.theme.logo = null
  }
  return { app: 'norm-scorm-builder', kind: 'template', version: TEMPLATE_VERSION, media, course: copy }
}

/**
 * Parse + validate a template file. Page ids are ALWAYS regenerated (cheap
 * insurance against hand-edited/duplicated ids, and loading the same template
 * twice stays trivially safe); onFailPageId is remapped through the same map.
 * Callers should still run the result through db.migrateCourse before dispatch.
 */
export function deserializeTemplate(json: string): { course: Course; media: TemplateMediaNote[] } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not a valid JSON file')
  }
  const env = raw as Partial<TemplateEnvelope>
  if (!env || typeof env !== 'object' || env.app !== 'norm-scorm-builder' || env.kind !== 'template') {
    throw new Error('Not a SCORM Builder template file')
  }
  if (typeof env.version !== 'number' || env.version > TEMPLATE_VERSION) {
    throw new Error('This template was saved by a newer version of the app — update and try again')
  }
  const course = env.course as Course
  if (!course || typeof course !== 'object' || !Array.isArray(course.pages)) {
    throw new Error('Template is malformed (no pages array)')
  }

  const idMap = new Map<string, string>()
  for (const p of course.pages) {
    if (!p || typeof p !== 'object') throw new Error('Template is malformed (bad page entry)')
    const fresh = crypto.randomUUID()
    if (typeof p.id === 'string' && p.id) idMap.set(p.id, fresh)
    p.id = fresh
    if (typeof p.title !== 'string') p.title = ''
    if (typeof p.body !== 'string') p.body = ''
  }
  if (course.onFailPageId) {
    const mapped = idMap.get(course.onFailPageId)
    if (mapped) course.onFailPageId = mapped
    else delete course.onFailPageId
  }
  if (typeof course.title !== 'string') course.title = 'Untitled Course'
  if (typeof course.passMark !== 'number' || !Number.isFinite(course.passMark)) course.passMark = 70
  if (course.scormVersion !== '2004') course.scormVersion = '1.2'

  return { course, media: Array.isArray(env.media) ? env.media : [] }
}
