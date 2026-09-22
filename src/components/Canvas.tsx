import { useRef, useState, type ReactNode } from 'react'
import type { Page, Question, MediaRef, Quiz } from '../lib/types'
import { isScorable } from '../lib/scoring'
import { renderRichText } from '../lib/rich'
import { useDispatch, useSelectedPage } from '../state'
import { useAttachFiles } from '../routing'
import { useMediaUrl } from '../hooks'
import { BlocksEditor } from './BlocksEditor'
import { Badge, Button } from './ui'

const ACCEPT = '.mp4,.webm,.mov,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.ogg,.pdf,.vtt,.srt,.xlsx,.xls,.csv'
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export function Canvas() {
  const page = useSelectedPage()
  const dispatch = useDispatch()
  const attach = useAttachFiles()

  if (!page) {
    return (
      <main className="flex min-h-0 items-center justify-center overflow-auto p-10 text-center">
        <div className="max-w-sm">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#3194a0" strokeWidth="1.5" className="mx-auto">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <h2 className="mb-2 mt-4 text-[19px] font-semibold">No pages yet</h2>
          <p className="mb-5 text-mut">
            Add a page, then drag a video, image, or Excel assessment onto it. Each page becomes a screen in the course.
          </p>
          <Button variant="primary" onClick={() => dispatch({ type: 'addPage' })}>＋ Add your first page</Button>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-0 overflow-auto"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length && !(e.target as HTMLElement).closest('[data-dropzone]')) {
          e.preventDefault()
          void attach(e.dataTransfer.files, page.id)
        }
      }}
    >
      <div className="mx-auto max-w-[680px] px-7 pb-16 pt-7">
        <input
          value={page.title}
          onChange={(e) => dispatch({ type: 'patchPage', id: page.id, patch: { title: e.target.value } })}
          placeholder="Page title"
          spellCheck={false}
          className="mb-3 w-full rounded-[9px] border border-line bg-panel px-3.5 py-3 text-[19px] font-semibold outline-none focus:border-teal"
        />
        <BodyEditor page={page} />

        <BlocksEditor page={page} />

        <DropTarget onFiles={(files) => void attach(files, page.id)} />

        {page.video && (
          <Slot label="Video" onRemove={() => dispatch({ type: 'setMedia', id: page.id, kind: 'video', ref: null })}>
            <VideoPreview media={page.video} />
          </Slot>
        )}
        {page.captions && (
          <Slot label="Captions" onRemove={() => dispatch({ type: 'setMedia', id: page.id, kind: 'captions', ref: null })}>
            <div className="font-mono text-[11px] text-mut">
              {page.captions.name} · {Math.max(1, Math.round(page.captions.size / 1024))} KB
            </div>
            <div className="mt-1 text-[11px] text-dim">
              Adds a CC track to this page's video. SRT files convert to WebVTT on attach.
            </div>
            {!page.video && <div className="mt-1 text-[11px] text-amber">No video on this page yet — captions ship only with a video.</div>}
          </Slot>
        )}
        {page.image && (
          <Slot label="Image" onRemove={() => dispatch({ type: 'setMedia', id: page.id, kind: 'image', ref: null })}>
            <ImagePreview media={page.image} />
          </Slot>
        )}
        {page.audio && (
          <Slot label="Audio" onRemove={() => dispatch({ type: 'setMedia', id: page.id, kind: 'audio', ref: null })}>
            <AudioPreview media={page.audio} />
          </Slot>
        )}
        {page.doc && (
          <Slot label="Document" onRemove={() => dispatch({ type: 'setMedia', id: page.id, kind: 'doc', ref: null })}>
            <DocPreview media={page.doc} />
          </Slot>
        )}
        {page.quiz && (
          <Slot label="Assessment" onRemove={() => dispatch({ type: 'setQuiz', id: page.id, quiz: null })}>
            <QuizPreview quiz={page.quiz} />
          </Slot>
        )}
      </div>
    </main>
  )
}

/**
 * Page body: markdown-subset source with a formatting toolbar and a live
 * preview rendered by the exact function the exported player uses (rich.ts).
 */
function BodyEditor({ page }: { page: Page }) {
  const dispatch = useDispatch()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const colorRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState(false)

  /** Wrap/prefix the current selection; keeps focus in the textarea. */
  function apply(fn: (sel: string) => string, fallback = 'text') {
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const sel = ta.value.slice(s, e) || fallback
    const insert = fn(sel)
    const body = ta.value.slice(0, s) + insert + ta.value.slice(e)
    dispatch({ type: 'patchPage', id: page.id, patch: { body } })
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s, s + insert.length)
    })
  }
  const eachLine = (prefix: (i: number) => string) => (sel: string) =>
    sel.split('\n').map((l, i) => prefix(i) + l).join('\n')

  const tools: [string, string, () => void][] = [
    ['B', 'Bold', () => apply((s) => `**${s}**`)],
    ['I', 'Italic', () => apply((s) => `*${s}*`)],
    ['H2', 'Heading', () => apply(eachLine(() => '# '), 'Heading')],
    ['H3', 'Subheading', () => apply(eachLine(() => '## '), 'Subheading')],
    ['•', 'Bullet list', () => apply(eachLine(() => '- '), 'item')],
    ['1.', 'Numbered list', () => apply(eachLine((i) => `${i + 1}. `), 'item')],
    ['🔗', 'Link', () => apply((s) => `[${s}](https://)`)],
  ]

  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center gap-1">
        {tools.map(([label, title, run]) => (
          <button
            key={title}
            title={title}
            onMouseDown={(e) => e.preventDefault() /* keep textarea selection */}
            onClick={run}
            className="cursor-pointer rounded border border-line bg-panel px-2 py-1 font-mono text-[11px] text-mut hover:border-teal hover:text-[#e7eef4]"
          >
            {label}
          </button>
        ))}
        <label
          title="Text color"
          onMouseDown={(e) => e.preventDefault()}
          className="cursor-pointer rounded border border-line bg-panel px-2 py-1 font-mono text-[11px] text-mut hover:border-teal"
        >
          A
          <input
            ref={colorRef}
            type="color"
            defaultValue="#4bbecb"
            className="h-0 w-0 opacity-0"
            onChange={(e) => apply((s) => `{c:${e.target.value}}${s}{/c}`)}
          />
        </label>
        <span className="flex-1" />
        <button
          onClick={() => setPreview((v) => !v)}
          className={`cursor-pointer rounded border px-2 py-1 font-mono text-[11px] ${
            preview ? 'border-teal bg-teal/15 text-tealbr' : 'border-line bg-panel text-mut hover:border-teal'
          }`}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div
          className="body-preview min-h-16 w-full rounded-[9px] border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#cdd8e2]"
          // safe by construction: renderRichText escapes every text run before emitting its own tags
          dangerouslySetInnerHTML={{ __html: renderRichText(page.body) || '<span class="text-dim">Nothing to preview…</span>' }}
        />
      ) : (
        <textarea
          ref={taRef}
          value={page.body}
          onChange={(e) => dispatch({ type: 'patchPage', id: page.id, patch: { body: e.target.value } })}
          placeholder={'Optional intro text shown above the media…  **bold**  *italic*  # heading  - list  [link](https://…)'}
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded-[9px] border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#cdd8e2] outline-none placeholder:text-dim focus:border-teal"
        />
      )}
    </div>
  )
}

function DropTarget({ onFiles }: { onFiles: (files: FileList) => void }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      data-dropzone
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          setOver(false)
          onFiles(e.dataTransfer.files)
        }
      }}
      className={`mb-4 cursor-pointer rounded-xl border-[1.5px] border-dashed bg-panel px-6 py-8 text-center transition-colors ${
        over ? 'border-tealbr bg-teal/10' : 'border-line2 hover:border-teal'
      }`}
    >
      <svg className="mx-auto mb-3 h-10 w-10 text-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 3v13" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      <b className="mb-1 block font-semibold">Drop a video, image, audio, PDF, captions, or Excel file here</b>
      <small className="font-mono text-[11px] tracking-[.5px] text-mut">MP4 / WEBM · PNG / JPG · MP3 / WAV · PDF · VTT / SRT · XLSX / CSV — or click to browse</small>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Slot({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-[11px] border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-line bg-panel2 px-3.5 py-2.5">
        <span className="lbl flex-1">{label}</span>
        <button
          onClick={onRemove}
          className="cursor-pointer rounded px-2 py-1 font-mono text-xs uppercase tracking-wider text-dim hover:bg-bad/15 hover:text-bad"
        >
          Remove
        </button>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  )
}

function VideoPreview({ media }: { media: MediaRef }) {
  const url = useMediaUrl(media)
  return (
    <>
      {url ? (
        <video controls preload="metadata" src={url} className="block w-full rounded-lg bg-black" />
      ) : (
        <div className="grid h-40 place-items-center rounded-lg bg-black/40 font-mono text-[11px] text-dim">loading…</div>
      )}
      <div className="mt-2 break-all font-mono text-[11px] text-mut">{media.name}</div>
    </>
  )
}

function AudioPreview({ media }: { media: MediaRef }) {
  const url = useMediaUrl(media)
  return (
    <>
      {url ? (
        <audio controls preload="metadata" src={url} className="block w-full" />
      ) : (
        <div className="grid h-12 place-items-center rounded-lg bg-black/40 font-mono text-[11px] text-dim">loading…</div>
      )}
      <div className="mt-2 break-all font-mono text-[11px] text-mut">
        {media.name} — learners must listen (95% / to the end) before the page counts as done
      </div>
    </>
  )
}

function DocPreview({ media }: { media: MediaRef }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-bad/15 font-mono text-[10px] text-bad">PDF</span>
      <div className="min-w-0">
        <div className="break-all font-mono text-[11px] text-mut">{media.name} · {Math.max(1, Math.round(media.size / 1024))} KB</div>
        <div className="mt-0.5 text-[11px] text-dim">
          Rendered inline in the player with an always-visible download link (some LMS setups block inline PDFs).
        </div>
      </div>
    </div>
  )
}

function ImagePreview({ media }: { media: MediaRef }) {
  const url = useMediaUrl(media)
  return (
    <>
      {url ? (
        <img src={url} alt="" className="block w-full rounded-lg border border-line" />
      ) : (
        <div className="grid h-40 place-items-center rounded-lg bg-black/40 font-mono text-[11px] text-dim">loading…</div>
      )}
      <div className="mt-2 break-all font-mono text-[11px] text-mut">{media.name}</div>
    </>
  )
}

const TYPE_TAG: Record<Question['t'], string | null> = {
  MCQ: null,
  MCA: 'MCA · select all',
  TF: 'TRUE / FALSE',
  FIB: 'FILL IN THE BLANK',
  NUM: 'NUMERIC',
  MAT: 'MATCHING',
  SEQ: 'SEQUENCE',
}

/** Editor-side answer preview per question type — mirrors what the player will grade. */
function AnswerPreview({ q }: { q: Question }) {
  if (q.t === 'FIB') {
    return <div className="text-xs text-ok">Accepted: {(q.a ?? []).join('  ·  ') || '—'}</div>
  }
  if (q.t === 'NUM') {
    return <div className="text-xs text-ok">= {q.num ? `${q.num.v}${q.num.tol ? ` ± ${q.num.tol}` : ''}` : '—'}</div>
  }
  if (q.t === 'MAT') {
    return (
      <div className="grid gap-1">
        {q.o.map((left, i) => (
          <div key={i} className="flex gap-2 rounded px-2 py-1 text-xs text-mut">
            <span>{left}</span>
            <span className="text-dim">↔</span>
            <span className="text-ok">{q.m?.[i] ?? '—'}</span>
          </div>
        ))}
      </div>
    )
  }
  if (q.t === 'SEQ') {
    const order = q.c.length === q.o.length ? q.c : q.o.map((_, i) => i)
    return (
      <div className="grid gap-1">
        {order.map((oi, k) => (
          <div key={k} className="flex gap-2 rounded px-2 py-1 text-xs text-mut">
            <span className="flex-none font-mono text-[11px] text-dim">{k + 1}.</span>
            <span>{q.o[oi]}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="grid gap-1">
      {q.o.map((o, oi) => (
        <div key={oi} className={`flex gap-2 rounded px-2 py-1 text-xs ${q.c.includes(oi) ? 'bg-ok/10 text-ok' : 'text-mut'}`}>
          <span className={`flex-none font-mono text-[11px] ${q.c.includes(oi) ? 'text-ok' : 'text-dim'}`}>{LETTERS[oi]}</span>
          <span>{o}</span>
        </div>
      ))}
    </div>
  )
}

function QuizPreview({ quiz }: { quiz: Quiz }) {
  const unscorable = quiz.questions.filter((q) => !isScorable(q)).length
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge>{quiz.questions.length} questions</Badge>
        <Badge>Source: {quiz.sourceName}</Badge>
        {quiz.draw && <Badge>shows {quiz.draw} of {quiz.questions.length}</Badge>}
        {quiz.bd && quiz.bankNames && (
          <Badge>
            banks: {quiz.bankNames.map((n, i) => `${n} (${quiz.bd![i]})`).join(' · ')}
          </Badge>
        )}
        {unscorable ? (
          <Badge tone="err">{unscorable} unscorable question{unscorable > 1 ? 's' : ''} — export blocked</Badge>
        ) : (
          <Badge tone="ok">✓ all questions scorable</Badge>
        )}
      </div>
      {quiz.questions.map((q, i) => (
        <div key={i} className="mb-2 rounded-lg border border-line bg-panel2 px-3 py-2.5">
          <div className="mb-1.5 text-[13px]">
            <b className="mr-2 font-mono text-[11px] text-teal">Q{q.n}</b>
            {q.q}
            {TYPE_TAG[q.t] && (
              <span className="ml-2 rounded border border-line px-1.5 py-px font-mono text-[9.5px] tracking-[.5px] text-tealbr">
                {TYPE_TAG[q.t]}
              </span>
            )}
            {q.b !== undefined && quiz.bankNames?.[q.b] && (
              <span className="ml-2 rounded border border-line px-1.5 py-px font-mono text-[9.5px] tracking-[.5px] text-mut">
                {quiz.bankNames[q.b]}
              </span>
            )}
          </div>
          <AnswerPreview q={q} />
          {(q.fb || q.fbc || q.fbi) && (
            <div className="mt-1.5 border-l-2 border-teal/50 pl-2 text-[11px] leading-snug text-dim">
              {q.fbc && <div>✓ {q.fbc}</div>}
              {q.fbi && <div>✗ {q.fbi}</div>}
              {q.fb && <div>{q.fb}</div>}
            </div>
          )}
          {!isScorable(q) && <div className="mt-1.5 font-mono text-xs text-bad">⚠ no gradable answer — see inspector</div>}
        </div>
      ))}
    </div>
  )
}
