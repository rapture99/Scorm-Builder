import { fileKind } from './files'

/**
 * Batch mode: a folder of {video, image, Excel} triples named in a numbered
 * series (R_005.mp4, E_005.png, A_005.xlsx → item "005") becomes N one-page
 * SCORM packages. Grouping key = the LAST run of digits in the basename.
 */

export interface Named {
  name: string
}

export interface BatchGroup<T extends Named> {
  key: string
  video?: T
  image?: T
  audio?: T
  doc?: T
  captions?: T
  quiz?: T
  /** e.g. two videos claim the same key — the extra file's name lands here. */
  conflicts: string[]
}

export interface BatchGrouping<T extends Named> {
  groups: BatchGroup<T>[]
  /** Files that could not be placed: no digits in name, or unsupported type. */
  skipped: { name: string; reason: string }[]
}

export function extractSeriesKey(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, '')
  const m = base.match(/(\d+)(?!.*\d)/)
  return m ? m[1] : null
}

export function groupBatchFiles<T extends Named>(files: T[]): BatchGrouping<T> {
  const byKey = new Map<string, BatchGroup<T>>()
  const skipped: { name: string; reason: string }[] = []

  for (const f of files) {
    const kind = fileKind(f.name)
    if (kind === 'unknown') {
      skipped.push({ name: f.name, reason: 'unsupported file type' })
      continue
    }
    const key = extractSeriesKey(f.name)
    if (!key) {
      skipped.push({ name: f.name, reason: 'no series number in filename' })
      continue
    }
    let g = byKey.get(key)
    if (!g) {
      g = { key, conflicts: [] }
      byKey.set(key, g)
    }
    if (g[kind]) {
      g.conflicts.push(`${f.name} (a ${kind} for item ${key} already exists: ${g[kind]!.name})`)
    } else {
      g[kind] = f
    }
  }

  const groups = [...byKey.values()].sort((a, b) => {
    const na = parseInt(a.key, 10)
    const nb = parseInt(b.key, 10)
    return na !== nb ? na - nb : a.key.localeCompare(b.key)
  })
  return { groups, skipped }
}

/** Default course title for a group: quiz basename wins (A_005.xlsx → "A_005"), then video, then image. */
export function defaultGroupTitle<T extends Named>(g: BatchGroup<T>): string {
  const src = g.quiz ?? g.video ?? g.image
  return src ? src.name.replace(/\.[^.]+$/, '') : `Course ${g.key}`
}
