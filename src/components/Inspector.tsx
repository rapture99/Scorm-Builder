import { useRef } from 'react'
import { useDispatch, useEditor, useSelectedPage } from '../state'
import { useMediaUrl } from '../hooks'
import { useToast } from '../toast'
import { findExportBlockers } from '../lib/packager'
import { presentedCount } from '../lib/scoring'
import { suspendWarning } from '../lib/suspend'
import { DEFAULT_THEME, LOGO_WARN_BYTES } from '../lib/theme'
import { putMedia, totalMediaBytes, WARN_TOTAL_BYTES } from '../lib/db'
import { Field, TextInput } from './ui'

export function Inspector() {
  const { course } = useEditor()
  const page = useSelectedPage()
  const dispatch = useDispatch()

  const totalQ = course.pages.reduce((s, p) => s + (p.quiz?.questions?.length ?? 0), 0)
  const blockers = findExportBlockers(course)
  const suspendMsg = suspendWarning(course)
  const mediaBytes = totalMediaBytes(course)
  const mediaMB = Math.round(mediaBytes / (1024 * 1024))

  return (
    <aside className="min-h-0 overflow-auto border-l border-line bg-rail">
      <section className="border-b border-line p-4">
        <h3 className="lbl mb-3.5 font-semibold">Course</h3>
        <Field label="Pass mark (%)">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={course.passMark}
            onChange={(e) => dispatch({ type: 'setPassMark', passMark: parseInt(e.target.value, 10) })}
          />
        </Field>
        <Field
          label="SCORM version"
          hint="1.2 has the widest LMS support. 2004 (4th Ed.) reports completion + success separately, a scaled score, and allows 64 KB of resume state."
        >
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['1.2', '2004'] as const).map((v) => (
              <button
                key={v}
                onClick={() => dispatch({ type: 'setScormVersion', version: v })}
                className={`flex-1 cursor-pointer py-2 font-mono text-xs ${
                  course.scormVersion === v ? 'bg-teal text-[#04222a]' : 'bg-panel text-mut hover:text-[#e7eef4]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Max attempts" hint="Graded submissions allowed per learner. 0 = unlimited retakes.">
          <TextInput
            type="number"
            min={0}
            max={99}
            value={course.maxAttempts ?? 0}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              dispatch({ type: 'patchCourse', patch: { maxAttempts: Number.isFinite(v) ? Math.max(0, Math.min(99, v)) : 0 } })
            }}
          />
        </Field>
        <Field
          label="Shuffle"
          hint="Re-rolled on every attempt; answers keep grading correctly. True/False never shuffles; a Shuffle column in the sheet overrides per question."
        >
          <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-xs text-mut">
            <input
              type="checkbox"
              checked={!!course.shuffleQuestions}
              onChange={(e) => dispatch({ type: 'patchCourse', patch: { shuffleQuestions: e.target.checked } })}
            />
            Question order
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-mut">
            <input
              type="checkbox"
              checked={!!course.shuffleOptions}
              onChange={(e) => dispatch({ type: 'patchCourse', patch: { shuffleOptions: e.target.checked } })}
            />
            Answer options
          </label>
        </Field>
        <Field
          label="Navigation"
          hint="Restricted: learners must finish each page (watch media, answer questions) before Next unlocks. Backward is always allowed; a retake re-locks media pages."
        >
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['free', 'restricted'] as const).map((v) => (
              <button
                key={v}
                onClick={() => dispatch({ type: 'patchCourse', patch: { navMode: v } })}
                className={`flex-1 cursor-pointer py-2 font-mono text-xs ${
                  (course.navMode ?? 'free') === v ? 'bg-teal text-[#04222a]' : 'bg-panel text-mut hover:text-[#e7eef4]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="After a failed attempt"
          hint='Adds a "Review the material" button to the results screen that jumps to this page.'
        >
          <select
            value={course.pages.some((p) => p.id === course.onFailPageId) ? course.onFailPageId : ''}
            onChange={(e) => dispatch({ type: 'patchCourse', patch: { onFailPageId: e.target.value || undefined } })}
            className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-[#e7eef4] outline-none focus:border-teal"
          >
            <option value="">Show results only (default)</option>
            {course.pages.map((p, i) => (
              <option key={p.id} value={p.id}>
                {i + 1} — {p.title || 'Untitled'}
              </option>
            ))}
          </select>
        </Field>
        {suspendMsg && (
          <div className="mt-2 rounded-lg border border-amber/40 bg-amber/10 p-2.5 text-[11.5px] leading-normal text-amber">
            {suspendMsg}
          </div>
        )}
      </section>

      <ThemeSection />

      {page ? (
        <section className="border-b border-line p-4">
          <h3 className="lbl mb-3.5 font-semibold">Page {course.pages.indexOf(page) + 1}</h3>
          <Field label="Title">
            <TextInput
              value={page.title}
              spellCheck={false}
              onChange={(e) => dispatch({ type: 'patchPage', id: page.id, patch: { title: e.target.value } })}
            />
          </Field>
          <Kv k="Video" v={page.video ? 'attached' : '—'} />
          <Kv k="Captions" v={page.captions ? 'attached' : '—'} />
          <Kv k="Image" v={page.image ? 'attached' : '—'} />
          <Kv k="Audio" v={page.audio ? 'attached' : '—'} />
          <Kv k="Document" v={page.doc ? 'attached' : '—'} />
          <Kv
            k="Questions"
            v={
              page.quiz?.questions?.length
                ? presentedCount(page.quiz) !== page.quiz.questions.length
                  ? `${presentedCount(page.quiz)} shown of ${page.quiz.questions.length}`
                  : String(page.quiz.questions.length)
                : '0'
            }
          />
          {(page.quiz?.problems?.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-bad">Unscorable questions</div>
              <div className="text-[11.5px] leading-normal text-bad">
                {page.quiz!.problems.map((p, i) => (
                  <div key={i}>{p}</div>
                ))}
                <div className="mt-2 text-dim">
                  Fix the spreadsheet so each Correct Answer exactly equals one option (or is a letter A–F), or follows
                  its question type's format, then re-drop it. Export stays blocked until every question is scorable.
                </div>
              </div>
            </div>
          )}
          {(page.quiz?.warnings?.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-amber">Authoring notes</div>
              <div className="text-[11.5px] leading-normal text-amber/90">
                {page.quiz!.warnings!.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="border-b border-line p-6 text-center text-[13px] leading-relaxed text-dim">
          Select or add a page to edit its title, media, and assessment.
        </section>
      )}

      <section className="p-4">
        <h3 className="lbl mb-3.5 font-semibold">Summary</h3>
        <Kv k="Pages" v={String(course.pages.length)} />
        <Kv k="Total questions" v={String(totalQ)} />
        <Kv k="Scoring issues" v={blockers.length ? String(blockers.length) : 'none'} tone={blockers.length ? 'bad' : 'ok'} />
        <Kv k="Media size" v={`${mediaMB} MB`} tone={mediaBytes > WARN_TOTAL_BYTES ? 'bad' : undefined} />
        <Kv
          k="Resume state"
          v={suspendMsg ? 'near limit' : 'compact'}
          tone={suspendMsg ? 'bad' : 'ok'}
        />
      </section>
    </aside>
  )
}

/** Player branding: scheme, accent color, font, logo. Applied to preview, export and batch alike. */
function ThemeSection() {
  const { course } = useEditor()
  const dispatch = useDispatch()
  const toast = useToast()
  const logoInput = useRef<HTMLInputElement>(null)
  const theme = course.theme ?? DEFAULT_THEME
  const logoUrl = useMediaUrl(course.theme?.logo ?? null)

  async function onLogoPick(f: File) {
    if (f.size > LOGO_WARN_BYTES) {
      toast(`Logo is ${Math.round(f.size / 1024)} KB — it is embedded into every package; keep it under 200 KB`, 'warn')
    }
    const mediaId = crypto.randomUUID()
    try {
      await putMedia(mediaId, f)
    } catch (err) {
      toast(`Could not store ${f.name}: ${(err as Error).message}`, 'err')
      return
    }
    dispatch({ type: 'patchTheme', patch: { logo: { mediaId, name: f.name, size: f.size, type: f.type } } })
    toast(`Logo attached: ${f.name}`)
  }

  return (
    <section className="border-b border-line p-4">
      <div className="mb-3.5 flex items-center">
        <h3 className="lbl flex-1 font-semibold">Theme</h3>
        {course.theme && (
          <button
            onClick={() => dispatch({ type: 'patchTheme', patch: null })}
            className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-dim hover:bg-panel2 hover:text-mut"
          >
            Reset
          </button>
        )}
      </div>
      <Field label="Scheme">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['dark', 'light'] as const).map((s) => (
            <button
              key={s}
              onClick={() => dispatch({ type: 'patchTheme', patch: { scheme: s } })}
              className={`flex-1 cursor-pointer py-2 font-mono text-xs ${
                theme.scheme === s ? 'bg-teal text-[#04222a]' : 'bg-panel text-mut hover:text-[#e7eef4]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Accent color">
        <div className="flex items-center gap-2.5">
          <input
            type="color"
            value={theme.primary}
            onChange={(e) => dispatch({ type: 'patchTheme', patch: { primary: e.target.value } })}
            className="h-8 w-12 cursor-pointer rounded border border-line bg-panel p-0.5"
          />
          <span className="font-mono text-[11px] text-mut">{theme.primary}</span>
        </div>
      </Field>
      <Field label="Font">
        <select
          value={theme.font}
          onChange={(e) => dispatch({ type: 'patchTheme', patch: { font: e.target.value as 'sans' | 'serif' | 'mono' } })}
          className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-[#e7eef4] outline-none focus:border-teal"
        >
          <option value="sans">Sans (system default)</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
      </Field>
      <Field label="Logo" hint="Replaces the mark in the player header. PNG/SVG/JPG, ideally square, under 200 KB.">
        <div className="flex items-center gap-2.5">
          {logoUrl && <img src={logoUrl} alt="logo" className="h-8 w-8 rounded border border-line object-contain" />}
          <button
            onClick={() => logoInput.current?.click()}
            className="cursor-pointer rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-mut hover:border-teal hover:text-[#e7eef4]"
          >
            {course.theme?.logo ? 'Replace…' : 'Upload…'}
          </button>
          {course.theme?.logo && (
            <button
              onClick={() => dispatch({ type: 'patchTheme', patch: { logo: null } })}
              className="cursor-pointer rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-dim hover:bg-bad/15 hover:text-bad"
            >
              Remove
            </button>
          )}
          <input
            ref={logoInput}
            type="file"
            accept=".png,.svg,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onLogoPick(f)
              e.target.value = ''
            }}
          />
        </div>
      </Field>
    </section>
  )
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-[#e7eef4]'
  return (
    <div className="flex justify-between border-b border-dashed border-line py-1.5 text-xs text-mut">
      <span>{k}</span>
      <b className={`font-mono text-xs ${color}`}>{v}</b>
    </div>
  )
}
