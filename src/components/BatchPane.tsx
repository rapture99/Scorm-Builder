import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { groupBatchFiles, defaultGroupTitle, type BatchGroup } from '../lib/batch'
import { srtToVtt } from '../lib/captions'
import { parseQuizWorkbook, type ParsedQuiz } from '../lib/excel'
import { buildScormPackage, packageFileName } from '../lib/packager'
import { makeVideoCompressor } from '../lib/compress'
import type { Course, MediaRef } from '../lib/types'
import { getMediaByRef } from '../lib/db'
import { filesFromDataTransfer } from '../lib/dropdir'
import { downloadBlob } from '../lib/download'
import { makeAssetNamer } from '../lib/files'
import { useEditor } from '../state'
import { useToast } from '../toast'
import { Badge, Button, TextInput } from './ui'

/**
 * Batch mode: a folder of numbered triples (R_005.mp4, E_005.png, A_005.xlsx)
 * → one single-page SCORM package per number, all through the same pipeline
 * as the visual editor. Pass mark and SCORM version come from the course settings.
 */
export function BatchPane() {
  const { course } = useEditor()
  const toast = useToast()
  const [files, setFiles] = useState<File[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [quizzes, setQuizzes] = useState<Record<string, ParsedQuiz>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  const grouping = useMemo(() => groupBatchFiles(files), [files])

  async function ingest(fs: File[]) {
    setFiles(fs)
    setTitles({})
    setQuizzes({})
    const { groups, skipped } = groupBatchFiles(fs)
    if (!groups.length) {
      toast('No usable files found — names need a series number, e.g. R_005.mp4', 'err')
      return
    }
    if (skipped.length) toast(`${skipped.length} file(s) skipped (unsupported type or no series number)`, 'warn')
    for (const g of groups) {
      if (g.quiz) {
        const parsed = parseQuizWorkbook(await g.quiz.arrayBuffer(), g.quiz.name)
        setQuizzes((prev) => ({ ...prev, [g.key]: parsed }))
      }
    }
  }

  function titleFor(g: BatchGroup<File>): string {
    return titles[g.key] ?? defaultGroupTitle(g)
  }

  function groupIssue(g: BatchGroup<File>): string | null {
    if (g.conflicts.length) return `conflicting files: ${g.conflicts.join('; ')}`
    if (g.quiz) {
      const parsed = quizzes[g.key]
      if (!parsed) return null // still parsing
      if (parsed.fatal) return `${g.quiz.name}: ${parsed.fatal}`
      if (parsed.problems.length) return `${parsed.problems.length} unscorable question(s): ${parsed.problems.join('; ')}`
    }
    return null
  }

  function isReady(g: BatchGroup<File>): boolean {
    if (groupIssue(g)) return false
    if (g.quiz && !quizzes[g.key]) return false
    return true
  }

  function courseFor(g: BatchGroup<File>): { c: Course; resolve: (ref: MediaRef) => Promise<Blob> } {
    const byId = new Map<string, File>()
    const mref = (f: File | undefined, kind: string): MediaRef | null => {
      if (!f) return null
      const id = `batch-${g.key}-${kind}`
      byId.set(id, f)
      return { mediaId: id, name: f.name, size: f.size, type: f.type }
    }
    const parsed = g.quiz ? quizzes[g.key] : undefined
    // spread-through (minus `fatal`) so new Quiz fields — draw, banks, warnings — survive
    let quiz = null
    if (parsed && !parsed.fatal) {
      const { fatal: _fatal, ...rest } = parsed
      quiz = rest
    }
    const title = titleFor(g)
    const c: Course = {
      title,
      // batch packages inherit every course-level setting from the editor's Course panel
      passMark: course.passMark,
      scormVersion: course.scormVersion,
      maxAttempts: course.maxAttempts,
      shuffleQuestions: course.shuffleQuestions,
      shuffleOptions: course.shuffleOptions,
      navMode: course.navMode,
      theme: course.theme,
      pages: [
        {
          id: `item-${g.key}`,
          title,
          body: '',
          video: mref(g.video, 'video'),
          image: mref(g.image, 'image'),
          audio: mref(g.audio, 'audio'),
          doc: mref(g.doc, 'doc'),
          captions: mref(g.captions, 'captions'),
          quiz,
        },
      ],
    }
    // an .srt in the folder ships as .vtt — rewrite the ref name to match the converted bytes
    const cap = c.pages[0].captions
    if (cap && /\.srt$/i.test(cap.name)) cap.name = cap.name.replace(/\.srt$/i, '.vtt')
    return {
      c,
      resolve: async (ref) => {
        const f = byId.get(ref.mediaId)
        // the theme logo's blob lives in the editor's IndexedDB, not the dropped folder
        if (!f) return getMediaByRef(ref)
        if (ref.mediaId.endsWith('-captions') && /\.srt$/i.test(f.name)) {
          return new Blob([srtToVtt(await f.text())], { type: 'text/vtt' })
        }
        return f
      },
    }
  }

  async function exportOne(g: BatchGroup<File>) {
    setBusy(`Packaging ${titleFor(g)}…`)
    try {
      const { c, resolve } = courseFor(g)
      const { blob, fileName } = await buildScormPackage(c, resolve, {
        transformVideo: makeVideoCompressor((ref, f) => setBusy(`Compressing ${ref.name}… ${Math.round(f * 100)}%`)),
      })
      downloadBlob(blob, fileName)
      toast(`Exported ${fileName} ✓`)
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setBusy(null)
    }
  }

  async function exportAll() {
    const ready = grouping.groups.filter(isReady)
    const blocked = grouping.groups.length - ready.length
    if (!ready.length) {
      toast('No items are ready to export — fix the issues listed in the table', 'err')
      return
    }
    const bundle = new JSZip()
    const claim = makeAssetNamer()
    let built = 0
    try {
      for (const g of ready) {
        built++
        setBusy(`Building ${built}/${ready.length} — ${titleFor(g)}…`)
        const { c, resolve } = courseFor(g)
        const { blob, fileName } = await buildScormPackage(c, resolve, {
          transformVideo: makeVideoCompressor((ref, f) =>
            setBusy(`Building ${built}/${ready.length} — compressing ${ref.name}… ${Math.round(f * 100)}%`),
          ),
        })
        // each entry is itself a complete SCORM zip; STORE — it's already deflated
        bundle.file(claim(fileName), await blob.arrayBuffer(), { compression: 'STORE' })
      }
      setBusy('Zipping bundle…')
      const out = await bundle.generateAsync({ type: 'blob' })
      downloadBlob(out, `SCORM_batch_${ready.length}_packages.zip`)
      toast(
        blocked
          ? `Exported ${ready.length} package(s) — ${blocked} item(s) BLOCKED, see the table`
          : `Exported ${ready.length} package(s) ✓`,
        blocked ? 'warn' : 'ok',
      )
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const readyCount = grouping.groups.filter(isReady).length

  return (
    <main className="min-h-0 overflow-auto">
      <div className="mx-auto max-w-[900px] px-7 pb-24 pt-7">
        <div
          onClick={() => folderInput.current?.click()}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setOver(true)
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void filesFromDataTransfer(e.dataTransfer).then((fs) => void ingest(fs))
          }}
          className={`cursor-pointer rounded-xl border-[1.5px] border-dashed bg-panel px-6 py-9 text-center transition-colors ${
            over ? 'border-tealbr bg-teal/10' : 'border-line2 hover:border-teal'
          }`}
        >
          <svg className="mx-auto mb-3 h-10 w-10 text-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <b className="mb-1 block font-semibold">Drop a folder of numbered triples</b>
          <small className="font-mono text-[11px] tracking-[.5px] text-mut">
            R_005.mp4 · E_005.png · A_005.xlsx → one SCORM package per number
          </small>
          <div className="mt-4 flex justify-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            <Button onClick={() => folderInput.current?.click()}>Choose folder</Button>
            <Button onClick={() => filesInput.current?.click()}>Choose files</Button>
          </div>
          <input
            ref={folderInput}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={(e) => {
              if (e.target.files?.length) void ingest(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void ingest(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        </div>

        {grouping.skipped.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-panel p-3 text-xs text-mut">
            <span className="lbl mr-2">Skipped</span>
            {grouping.skipped.map((s) => `${s.name} (${s.reason})`).join(' · ')}
          </div>
        )}

        {grouping.groups.length > 0 && (
          <>
            <div className="mt-6 overflow-hidden rounded-[11px] border border-line bg-panel">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-panel2 text-left">
                    <th className="lbl px-3 py-2.5 font-semibold">#</th>
                    <th className="lbl px-3 py-2.5 font-semibold">Package title</th>
                    <th className="lbl px-3 py-2.5 font-semibold">Contents</th>
                    <th className="lbl px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {grouping.groups.map((g) => {
                    const issue = groupIssue(g)
                    const parsed = g.quiz ? quizzes[g.key] : undefined
                    const parsing = !!g.quiz && !parsed
                    return (
                      <tr key={g.key} className="border-b border-line last:border-0 align-top">
                        <td className="px-3 py-2.5 font-mono text-xs text-teal">{g.key}</td>
                        <td className="px-3 py-2.5">
                          <TextInput
                            value={titleFor(g)}
                            spellCheck={false}
                            onChange={(e) => setTitles((t) => ({ ...t, [g.key]: e.target.value }))}
                            className="min-w-36"
                          />
                          <div className="mt-1 font-mono text-[10px] text-dim">{packageFileName(titleFor(g), course.scormVersion)}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {g.video && <Badge tone="mut">▶ {g.video.name}</Badge>}
                            {g.image && <Badge tone="mut">⛰ {g.image.name}</Badge>}
                            {g.audio && <Badge tone="mut">♫ {g.audio.name}</Badge>}
                            {g.doc && <Badge tone="mut">⎘ {g.doc.name}</Badge>}
                            {g.captions && <Badge tone="mut">cc {g.captions.name}</Badge>}
                            {g.quiz && <Badge tone="mut">? {g.quiz.name}{parsed && !parsed.fatal ? ` · ${parsed.questions.length}q` : ''}</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {parsing ? (
                            <Badge tone="mut">parsing…</Badge>
                          ) : issue ? (
                            <div>
                              <Badge tone="err">Blocked</Badge>
                              <div className="mt-1 max-w-64 text-[11px] leading-snug text-bad">{issue}</div>
                            </div>
                          ) : (
                            <Badge tone="ok">Ready</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button disabled={!isReady(g) || busy !== null} onClick={() => void exportOne(g)}>
                            Download
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <Button variant="primary" disabled={busy !== null || readyCount === 0} onClick={() => void exportAll()}>
                Export {readyCount} package{readyCount === 1 ? '' : 's'} (single bundle zip)
              </Button>
              {busy && <span className="font-mono text-[11px] text-mut">{busy}</span>}
              <span className="text-[11.5px] text-dim">
                Pass mark {course.passMark}% · SCORM {course.scormVersion}
                {course.maxAttempts ? ` · max ${course.maxAttempts} attempt${course.maxAttempts > 1 ? 's' : ''}` : ''}
                {course.shuffleQuestions || course.shuffleOptions ? ' · shuffle on' : ''}
                {course.theme ? ' · theme inherited' : ''} (all set in the editor's Course panel). The bundle zip is a
                wrapper — upload the individual *_{course.scormVersion === '2004' ? 'SCORM2004' : 'SCORM12'}.zip files
                inside it to the LMS.
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
