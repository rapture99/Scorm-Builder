import { openDB, type IDBPDatabase } from 'idb'
import { BLOCK_KINDS, courseMediaRefs, type Course, type MediaRef, type QType } from './types'

/**
 * Persistence: the project JSON and every media blob live in IndexedDB, so a
 * refresh loses nothing and large videos never sit in React state — the UI
 * holds MediaRefs and reads blobs on demand (playback, export).
 */

const DB_NAME = 'norm-scorm-builder'
const DB_VERSION = 1
const PROJECT_KEY = 'current'

/** Warn thresholds — packaging happens in-tab, so huge decks risk OOM. */
export const WARN_FILE_BYTES = 200 * 1024 * 1024
export const WARN_TOTAL_BYTES = 800 * 1024 * 1024

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('project')) d.createObjectStore('project')
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media')
    },
  })
  return dbPromise
}

export async function saveProject(course: Course): Promise<void> {
  await (await db()).put('project', course, PROJECT_KEY)
}

export async function loadProject(): Promise<Course | null> {
  const v = await (await db()).get('project', PROJECT_KEY)
  return v ? migrateCourse(v as Course) : null
}

const KNOWN_QTYPES: readonly QType[] = ['MCQ', 'MCA', 'TF', 'FIB', 'NUM', 'MAT', 'SEQ']

/**
 * Projects saved before MCA/TF support stored `c` as a single integer and `t`
 * as free text. Exported for tests — a type missing from KNOWN_QTYPES gets
 * silently coerced to MCQ here, which corrupts saved courses.
 */
export function migrateCourse(course: Course): Course {
  for (const p of course.pages) {
    if (!p.quiz?.questions) continue
    for (const q of p.quiz.questions) {
      const c = q.c as unknown
      if (typeof c === 'number') q.c = c < 0 ? [] : [c]
      else if (!Array.isArray(c)) q.c = []
      if (!KNOWN_QTYPES.includes(q.t)) q.t = 'MCQ'
    }
  }
  // defensive block normalization — unknown kinds dropped, missing ids backfilled
  for (const p of course.pages) {
    if (p.blocks === undefined) continue
    if (!Array.isArray(p.blocks)) {
      delete p.blocks
      continue
    }
    p.blocks = p.blocks.filter((b) => b && BLOCK_KINDS.includes(b.kind))
    for (const b of p.blocks) {
      b.id ||= crypto.randomUUID()
      const items = 'items' in b ? b.items : 'cards' in b ? b.cards : 'spots' in b ? b.spots : []
      if (Array.isArray(items)) for (const it of items) it.id ||= crypto.randomUUID()
    }
  }
  // defensive theme normalization — hand-edited/older projects must still load
  const t = course.theme
  if (t) {
    if (typeof t.primary !== 'string' || !/^#[0-9a-f]{6}$/i.test(t.primary)) t.primary = '#3194A0'
    if (t.scheme !== 'light' && t.scheme !== 'dark') t.scheme = 'dark'
    if (t.font !== 'sans' && t.font !== 'serif' && t.font !== 'mono') t.font = 'sans'
  }
  return course
}

export async function putMedia(mediaId: string, blob: Blob): Promise<void> {
  await (await db()).put('media', blob, mediaId)
}

export async function getMedia(mediaId: string): Promise<Blob | undefined> {
  return (await (await db()).get('media', mediaId)) as Blob | undefined
}

export async function getMediaByRef(ref: MediaRef): Promise<Blob> {
  const blob = await getMedia(ref.mediaId)
  if (!blob) throw new Error(`Media "${ref.name}" is missing from local storage`)
  return blob
}

export async function deleteMedia(mediaId: string): Promise<void> {
  await (await db()).delete('media', mediaId)
}

/** Drop blobs no longer referenced by any page (called after saves). */
export async function pruneMedia(referenced: Set<string>): Promise<void> {
  const d = await db()
  const keys = (await d.getAllKeys('media')) as string[]
  const tx = d.transaction('media', 'readwrite')
  await Promise.all(keys.filter((k) => !referenced.has(k)).map((k) => tx.store.delete(k)))
  await tx.done
}

export function referencedMediaIds(course: Course): Set<string> {
  return new Set(courseMediaRefs(course).map((r) => r.mediaId))
}

export function totalMediaBytes(course: Course): number {
  return courseMediaRefs(course).reduce((total, r) => total + r.size, 0)
}
