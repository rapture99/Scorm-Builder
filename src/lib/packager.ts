import JSZip from 'jszip'
import type { Course, MediaRef, ScormVersion } from './types'
import { buildManifest } from './manifest'
import { buildPlayerHtml } from './player'
import { buildExportDeck } from './deck'
import { sanitizeFilename } from './files'
import { isScorable } from './scoring'
import { resolveDeckTheme } from './theme'

/** A question with no gradable answer. Any of these blocks export. */
export interface ExportBlocker {
  pageIndex: number
  pageTitle: string
  questionN: string | number
}

/** Scans every question — including those inside undrawn bank subsets. */
export function findExportBlockers(course: Course): ExportBlocker[] {
  const blockers: ExportBlocker[] = []
  course.pages.forEach((p, i) => {
    p.quiz?.questions?.forEach((q) => {
      if (!isScorable(q)) blockers.push({ pageIndex: i, pageTitle: p.title || `Page ${i + 1}`, questionN: q.n })
    })
  })
  return blockers
}

export function blockerMessage(blockers: ExportBlocker[]): string {
  const list = blockers.map((b) => `Page ${b.pageIndex + 1} ("${b.pageTitle}") · Q${b.questionN}`).join('; ')
  return `Export blocked — ${blockers.length} question(s) have no scorable correct answer: ${list}. Fix the spreadsheet so each Correct Answer exactly equals one option (or is a letter A–F), or follows its question type's format, then re-drop it.`
}

export type BlobResolver = (ref: MediaRef) => Promise<Blob>

/** Result of a video transform: the re-encoded bytes plus their replacement file name. */
export interface TransformedVideo {
  blob: Blob
  /** Replacement file name when the container changed (e.g. .mov → .mp4). Omit to keep the original. */
  name?: string
}

/**
 * Optional export-time hook to shrink page videos (see compress.ts). Runs before
 * the deck/manifest are built so the new name and size flow into everything.
 * Return null to ship the original file unchanged.
 */
export type VideoTransform = (blob: Blob, ref: MediaRef) => Promise<TransformedVideo | null>

export interface PackageOptions {
  transformVideo?: VideoTransform
}

export function packageFileName(title: string, version: ScormVersion): string {
  const suffix = version === '2004' ? 'SCORM2004' : 'SCORM12'
  return `${sanitizeFilename((title || 'course').trim().replace(/\s+/g, '_'))}_${suffix}.zip`
}

/**
 * Assemble the SCORM package (1.2 or 2004, per course.scormVersion). Layout
 * (all at archive root — never nested in a wrapper folder, or the LMS rejects
 * the import):
 *   imsmanifest.xml
 *   index.html
 *   assets/<media…>
 * Throws with a page/question-naming message if any question is unscorable.
 */
export async function buildScormPackage(
  course: Course,
  getBlob: BlobResolver,
  opts: PackageOptions = {},
): Promise<{ blob: Blob; fileName: string }> {
  if (!course.pages.length) throw new Error('Nothing to export — the course has no pages')
  const blockers = findExportBlockers(course)
  if (blockers.length) throw new Error(blockerMessage(blockers))

  // Transform videos first — sequentially, encoders are memory-heavy — so the
  // deck, manifest and zip all see the final file name and bytes.
  const videoOverrides = new Map<string, Blob>()
  let prepared = course
  if (opts.transformVideo) {
    const pages: Course['pages'] = []
    for (const p of course.pages) {
      if (!p.video) {
        pages.push(p)
        continue
      }
      const original = await getBlob(p.video)
      if (!original) throw new Error(`Media "${p.video.name}" is missing from storage — re-attach it and export again`)
      const t = await opts.transformVideo(original, p.video)
      if (!t) {
        pages.push(p)
        continue
      }
      videoOverrides.set(p.video.mediaId, t.blob)
      pages.push({ ...p, video: { ...p.video, name: t.name ?? p.video.name, size: t.blob.size, type: t.blob.type || p.video.type } })
    }
    prepared = { ...course, pages }
  }

  // theme logo becomes a data URI inside the deck — never an extra zip asset
  const theme = await resolveDeckTheme(course.theme, getBlob)
  const { deck, assets } = buildExportDeck(prepared, theme)
  const html = buildPlayerHtml(deck)
  const manifest = buildManifest({
    title: deck.title,
    passMark: course.passMark,
    scormVersion: course.scormVersion,
    files: ['index.html', ...assets.map((a) => a.path)],
  })

  const zip = new JSZip()
  zip.file('imsmanifest.xml', manifest)
  zip.file('index.html', html)
  for (const asset of assets) {
    const blob = videoOverrides.get(asset.ref.mediaId) ?? (await getBlob(asset.ref))
    if (!blob) throw new Error(`Media "${asset.ref.name}" is missing from storage — re-attach it and export again`)
    // ArrayBuffer works in browser and Node alike (JSZip needs FileReader for Blob input)
    zip.folder('assets')!.file(asset.path.slice('assets/'.length), await blob.arrayBuffer())
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    // media is already compressed; recompressing wastes time for ~0 gain
    streamFiles: true,
  })
  return { blob, fileName: packageFileName(course.title, course.scormVersion) }
}
