/** Extract Files from a drop, walking directories (webkitGetAsEntry API). */

interface FsEntry {
  isFile: boolean
  isDirectory: boolean
  file(cb: (f: File) => void, err?: (e: unknown) => void): void
  createReader(): { readEntries(cb: (es: FsEntry[]) => void, err?: (e: unknown) => void): void }
}

async function walk(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const f = await new Promise<File | null>((res) => entry.file(res, () => res(null)))
    if (f) out.push(f)
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    // readEntries yields batches (Chrome caps at 100) — loop until empty
    for (;;) {
      const batch = await new Promise<FsEntry[]>((res) => reader.readEntries(res, () => res([])))
      if (!batch.length) break
      for (const e of batch) await walk(e, out)
    }
  }
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries: FsEntry[] = []
  for (const item of Array.from(dt.items)) {
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry
    const entry = getEntry ? getEntry.call(item) : null
    if (entry) entries.push(entry)
  }
  if (!entries.length) return Array.from(dt.files)
  const out: File[] = []
  for (const e of entries) await walk(e, out)
  return out
}
