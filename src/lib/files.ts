/** File-type routing and asset filename handling shared by editor and batch mode. */

export const VIDEO_RE = /\.(mp4|webm|mov)$/i
export const IMAGE_RE = /\.(png|jpe?g|webp)$/i
export const AUDIO_RE = /\.(mp3|m4a|wav|ogg)$/i
export const DOC_RE = /\.pdf$/i
export const CAPTION_RE = /\.(vtt|srt)$/i
export const SHEET_RE = /\.(xlsx|xls|csv)$/i

export type FileKind = 'video' | 'image' | 'audio' | 'doc' | 'captions' | 'quiz' | 'unknown'

export function fileKind(name: string): FileKind {
  if (VIDEO_RE.test(name)) return 'video'
  if (IMAGE_RE.test(name)) return 'image'
  if (AUDIO_RE.test(name)) return 'audio'
  if (DOC_RE.test(name)) return 'doc'
  if (CAPTION_RE.test(name)) return 'captions'
  if (SHEET_RE.test(name)) return 'quiz'
  return 'unknown'
}

/** Make a filename safe for zip entries and LMS web servers. */
export function sanitizeFilename(name: string): string {
  const s = name.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^\.+/, '')
  return s || 'file'
}

/**
 * Allocate unique asset names. Call `claim` per media file; collisions get
 * `_2`, `_3`, … inserted before the extension.
 */
export function makeAssetNamer(): (name: string) => string {
  const used = new Set<string>()
  return (name: string) => {
    const base = sanitizeFilename(name)
    let candidate = base
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = base.includes('.')
        ? base.replace(/(\.[^.]+)$/, `_${n}$1`)
        : `${base}_${n}`
      n++
    }
    used.add(candidate.toLowerCase())
    return candidate
  }
}
