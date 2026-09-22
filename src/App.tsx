import { useRef, useState } from 'react'
import { useDispatch, useEditor } from './state'
import { useToast } from './toast'
import { findExportBlockers, blockerMessage, buildScormPackage } from './lib/packager'
import { makeVideoCompressor } from './lib/compress'
import { suspendWarning } from './lib/suspend'
import { getMediaByRef, migrateCourse } from './lib/db'
import { downloadBlob } from './lib/download'
import { sanitizeFilename } from './lib/files'
import { serializeTemplate, deserializeTemplate } from './lib/template'
import { Rail } from './components/Rail'
import { Canvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { PreviewModal } from './components/PreviewModal'
import { BatchPane } from './components/BatchPane'
import { Button, Logo } from './components/ui'

type Mode = 'editor' | 'batch'

export default function App() {
  const { course, loaded } = useEditor()
  const dispatch = useDispatch()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('editor')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  async function handleExport() {
    if (!course.pages.length) {
      toast('Nothing to export — add a page first', 'err')
      return
    }
    // fail loud: never ship an unscorable question silently
    const blockers = findExportBlockers(course)
    if (blockers.length) {
      toast(blockerMessage(blockers), 'err')
      return
    }
    const warn = suspendWarning(course)
    if (warn) toast(warn, 'warn')
    setExporting(true)
    try {
      const { blob, fileName } = await buildScormPackage(course, getMediaByRef, {
        transformVideo: makeVideoCompressor((_ref, f) => setExportStatus(`Compressing video… ${Math.round(f * 100)}%`)),
      })
      downloadBlob(blob, fileName)
      toast(`SCORM package exported ✓ (${fileName})`)
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setExporting(false)
      setExportStatus(null)
    }
  }

  function handlePreview() {
    if (!course.pages.length) {
      toast('Add a page first', 'err')
      return
    }
    setPreviewOpen(true)
  }

  const tplInput = useRef<HTMLInputElement>(null)

  function saveTemplate() {
    if (!course.pages.length) {
      toast('Nothing to save — add a page first', 'err')
      return
    }
    const envelope = serializeTemplate(course)
    const name = `${sanitizeFilename((course.title || 'course').trim().replace(/\s+/g, '_'))}.template.json`
    downloadBlob(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }), name)
    toast(
      envelope.media.length
        ? `Template saved ✓ (structure only — ${envelope.media.length} media file(s) not included)`
        : 'Template saved ✓',
    )
  }

  async function loadTemplate(file: File) {
    let result: ReturnType<typeof deserializeTemplate>
    try {
      result = deserializeTemplate(await file.text())
    } catch (err) {
      toast((err as Error).message, 'err')
      return
    }
    // destructive: autosave GC will prune the current course's now-orphaned media blobs
    const ok = window.confirm(
      `Replace the current course "${course.title}"?\n\nTemplates contain no media — the current course's media will be removed from local storage.`,
    )
    if (!ok) return
    dispatch({ type: 'load', course: migrateCourse(result.course) })
    if (result.media.length) {
      const list = result.media
        .slice(0, 5)
        .map((m) => `${m.name} (${m.kind === 'logo' ? 'theme logo' : `page ${m.page} ${m.kind}`})`)
        .join(', ')
      const extra = result.media.length > 5 ? ` +${result.media.length - 5} more` : ''
      toast(`Template loaded — re-attach media: ${list}${extra}`, 'warn')
    } else {
      toast('Template loaded ✓')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 flex-none items-center gap-3.5 border-b border-line bg-ink/90 px-4">
        <Logo className="h-[26px] w-[26px]" />
        <div className="flex flex-col leading-[1.1]">
          <b className="text-sm font-semibold tracking-[.2px]">SCORM Builder</b>
          <span className="font-mono text-[9.5px] uppercase tracking-[2px] text-dim">Element Tree</span>
        </div>

        <div className="ml-3 flex overflow-hidden rounded-lg border border-line">
          {(['editor', 'batch'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`cursor-pointer px-3.5 py-1.5 font-mono text-xs capitalize tracking-[.5px] ${
                mode === m ? 'bg-teal text-[#04222a]' : 'bg-panel text-mut hover:text-[#e7eef4]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'editor' && (
          <input
            value={course.title}
            onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
            spellCheck={false}
            className="w-full max-w-[340px] rounded-[7px] border border-transparent bg-transparent px-2.5 py-[7px] text-sm font-medium outline-none hover:border-line focus:border-teal focus:bg-panel"
          />
        )}

        <div className="flex-1" />

        {mode === 'editor' && (
          <>
            <Button onClick={saveTemplate} title="Download the course structure as a reusable template (no media)">
              Save template
            </Button>
            <Button onClick={() => tplInput.current?.click()} title="Load a saved template, replacing the current course">
              Load
            </Button>
            <input
              ref={tplInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void loadTemplate(f)
                e.target.value = ''
              }}
            />
            <Button onClick={handlePreview}>
              <EyeIcon /> Preview
            </Button>
            <Button variant="primary" onClick={() => void handleExport()} disabled={exporting}>
              <DownloadIcon /> {exporting ? exportStatus ?? 'Packaging…' : 'Export SCORM'}
            </Button>
          </>
        )}
      </header>

      {!loaded ? (
        <div className="grid flex-1 place-items-center font-mono text-[11px] text-dim">restoring project…</div>
      ) : mode === 'editor' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[216px_1fr_320px]">
          <Rail />
          <Canvas />
          <Inspector />
        </div>
      ) : (
        <BatchPane />
      )}

      {previewOpen && <PreviewModal course={course} onClose={() => setPreviewOpen(false)} />}
    </div>
  )
}

function EyeIcon() {
  return (
    <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}
