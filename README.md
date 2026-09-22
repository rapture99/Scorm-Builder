# SCORM Builder — Element Tree

Browser-based authoring tool that turns pages of {video, image, audio, PDF, Excel quiz} into
downloadable, spec-compliant **SCORM 1.2 or SCORM 2004 (4th Edition)** packages. Everything runs
client-side — parsing (SheetJS), packaging (JSZip), persistence (IndexedDB). No server.

```bash
npm install
npm run dev      # editor at http://localhost:5173
npm test         # unit tests (Excel resolution, manifest, zip layout, player runtime, batch grouping)
npm run build    # production build → dist/
npx vite-node scripts/e2e.ts   # offline end-to-end: xlsx + blocks + captions → package → verify zip
```

## Two modes

**Editor** — three-pane visual authoring: page rail (drag to reorder, chips for attached media +
blocks), canvas (title + rich-text body with a formatting toolbar and live preview + **interactive
content blocks** + universal drop target that routes mp4→video, png/jpg→image, mp3/wav→audio,
pdf→document, vtt/srt→captions, xlsx/csv→quiz), inspector (pass mark, SCORM version, max attempts,
shuffle, navigation mode, fail-remediation page, theme, per-page quiz validation, course summary).
Preview renders the *exact* exported player. Projects & media persist in IndexedDB; course
structure can be saved/loaded as a **template** (header buttons).

**Batch** — drop a folder of numbered files (`R_005.mp4`, `E_005.png`, `N_005.mp3`, `S_005.pdf`,
`R_005.vtt`, `A_005.xlsx`) and get one single-page package per number (`A_005_SCORM12.zip`, …).
Grouping key is the last digit run in the filename. Per-item validation table, editable titles,
per-row download or a single bundle zip. Pass mark, SCORM version, max attempts, shuffle,
navigation mode and theme are all inherited from the editor's Course panel.
Both modes share one pipeline: deck build → player inject → manifest → zip.

## Interactive content blocks (Rise-style)

Each page can carry an ordered list of blocks, authored in the canvas and rendered between the
body text and the media. Six kinds: **accordion** (collapsible sections), **tabs**, **flashcards**
(click to flip), **click-to-reveal**, **timeline**, and **image hotspots** (upload an image, click
to place numbered markers, each opening an explanation panel — percent-anchored so they track
responsive scaling). All block text supports the same markdown subset as page bodies and is
sanitized at build time. Blocks are presentation-only: they never gate completion and never touch
resume state, and they're built accessible (real buttons, `aria-expanded`, tablist keyboard
navigation, labeled markers). Empty blocks are dropped at export rather than shipped.

## Question types (Excel-authored)

Header row (case-insensitive, tolerant of variants):
`Number | Question | Option A–F | Correct Answer | Question Type | Feedback | Correct Feedback | Incorrect Feedback | Tolerance | Shuffle | Bank | Draw`
— only Question, Option A and Correct Answer are required (and Option A too is optional when every
row is FIB/NUM). Aliases accepted throughout (`no/sr/#`, `stem`, `a/opt a/choice a`, `answer/key`, …).

| Type (`Question Type` cell) | Answering | `Correct Answer` encoding |
|---|---|---|
| **MCQ** (default) | radios | option full text, or letter A–F |
| **MCA** (`Multi-select`, `Checkbox`…) | checkboxes, all-or-nothing | `A, C` · `Paris, Berlin` · `AC` |
| **TF** (`T/F`, `True/False`…) | radios | `True/False/T/F`, boolean cells; blank options auto-fill |
| **FIB** (`Fill in the blank`, `Short answer`…) | typed text (≤80 chars), case/whitespace-insensitive | accepted answers separated by `\|` — `speed\|her speed` |
| **NUM** (`Numeric`, `Number`) | typed number | `225` · `1.5 ± 0.2` · `40..44` (or a `Tolerance` column) |
| **MAT** (`Matching`, `Pairs`…) | one dropdown per left item | pairs live in the option cells: `Port = Left side` (also `::`, `->`, `=>`); Correct Answer ignored |
| **SEQ** (`Sequencing`, `Ordering`…) | ▲/▼ reorder rows | the right order: `C, A, D, B` · `CADB` · `3142` · full texts; blank = as listed |

MCQ/MCA/TF are inferred when the type cell is blank (multi-answer → MCA, True/False options → TF);
**FIB/NUM/MAT/SEQ are never inferred** — legacy sheets parse byte-for-byte identically. A row whose
type says MCQ/TF but lists several answers is flagged (export blocked) rather than guessed.

Per-question extras (all optional): **feedback** (`Feedback` always shows after grading;
`Correct/Incorrect Feedback` win per outcome), a **Shuffle** yes/no override, a **Bank** label
(rows sharing a label form a pool) and **Draw** (bankless: show N of M; per bank: how many variants
to draw, default 1). Unscorable rows block export loudly; layout notes (ignored cells, clamped
draws) are non-blocking warnings in the inspector.

A ready-made workbook exercising every type ships at `Tier1_Sample_A_101.xlsx` (project root) —
drop it onto a page to see FIB/NUM/MAT/SEQ, feedback, shuffle and banks in action.

## Course-level settings

- **Max attempts** — graded submissions per learner (0 = unlimited); Retake disables at the cap and
  the state survives resume.
- **Navigation** — `free` (default) or `restricted`: Next and forward page-dots stay locked until
  the current page is finished (media consumed AND questions answered); backward is always allowed,
  and navigation roams free after grading so review works. Resume clamps back to the first
  unfinished page. (True skip-logic branching is deliberately unsupported — the course is one SCO
  scored over every question.)
- **After a failed attempt** — optionally pick a page; the results screen then offers a
  "Review the material" button that jumps straight to it.
- **Shuffle** — question order and/or answer options, driven by a single 31-bit seed persisted in
  `suspend_data`: layouts survive resume, re-roll per attempt, and answers stay in canonical index
  space so grading is permutation-proof. TF never shuffles; "All/None of the above" stays pinned
  last; MAT right columns and SEQ starting orders are always seeded so questions never start solved.
- **Theme** — dark/light scheme, accent color (WCAG-luminance-aware text contrast — a yellow accent
  on the light scheme is darkened for text roles automatically), font stack (system
  sans/serif/mono), optional logo (shipped as a data URI inside the deck — never an extra asset).
  Unthemed output is byte-identical to the classic look.

## Correctness rules (enforced, tested)

1. **`imsmanifest.xml` at the archive root** — never nested; a wrapper folder makes the LMS reject
   the import. Verified by `packager.test.ts` reading the zip back.
2. **Excel correct-answer resolution**: (1) exact full-text match against an option, then
   (2) letter A–F fallback; MCA cells split on `, ; / & +` with every token resolved the same way
   (compact letter runs like "AC" also work). Resolved to **integer indexes at build time** — the
   runtime only compares values it resolved itself. See `resolveCorrectIndexes` / `resolveFib` /
   `resolveNumeric` / `parseMatchPairs` / `resolveSequence` in [src/lib/excel.ts](src/lib/excel.ts).
3. **Fail loud**: any question with no gradable answer blocks export, naming the Page/Q — including
   questions inside an undrawn bank subset (`isScorable` in [src/lib/scoring.ts](src/lib/scoring.ts)).
4. **suspend_data within the version's ceiling** (~4096 chars on 1.2, 64k on 2004): resume state is
   `{a answers, w watched-bitmask, sub, cp, sd seed, at attempts}` with short keys; the estimator
   models per-type worst cases (FIB capped at 80 chars) and the inspector warns at 85%.
5. **Rich text is sanitized by construction** ([src/lib/rich.ts](src/lib/rich.ts)): every text run
   is HTML-escaped before token substitution; link URLs must be http(s)/mailto; colors must be hex
   literals. Raw HTML renders as visible text, never markup.
6. **Verify on SCORM Cloud, not locally** — see the smoke check below.

## Exported package layout

```
Course_SCORM12.zip
├── imsmanifest.xml     ← at the root, always
├── index.html          ← self-contained player (SCORM wrapper + theme inlined)
└── assets/
    ├── p1_R_005.mp4    ← sanitized + deduped names (video/image/audio/pdf)
    └── p1_E_005.png
```

**Video compression at export** (editor and batch): videos are re-encoded with the browser's own
codecs (WebCodecs via mediabunny, lazy-loaded) — H.264 MP4, longest edge capped at 1280px, bitrate
targeted by output area, audio copied bit-for-bit. The original file ships unchanged whenever
compression wouldn't help: source already efficient, saving under 15%, no WebCodecs in the browser,
or any conversion error — export never fails because of compression. A re-encoded `.mov`/`.webm`
is renamed `.mp4` throughout (assets/, manifest, player deck).

Player behavior: multi-page nav (Prev/Next + dots, optional restricted gating), video & audio
consumption tracking (95%/ended, per-page bitmask), **closed captions** (`.vtt` native, `.srt`
auto-converted on attach) as a default CC track, video download deterred
(`controlslist="nodownload"`, context menu blocked on the video only; deterrence, not DRM), PDF
inline via iframe + always-visible download link (marks viewed on open), image lightbox, all six
interactive block kinds, all seven question types, per-question feedback after grading, result
card with per-question ✓/✗ chips that jump back into review (+ optional fail-remediation button),
score aggregated across all quiz pages, resume via `suspend_data` (seeded layouts included),
retake with attempt limits, graceful preview mode when no LMS API is found (walks parent
frames/opener, ≤500 hops). **Accessibility**: landmark roles, dialog semantics with focus
management and a Tab trap (result card + lightbox, Escape closes), a polite live region announcing
page changes and grades, labeled nav dots/chips, focus-visible styles on every control, ARIA-wired
blocks. One inlined wrapper speaks both dialects — it hunts the packaged version's API object first
(`API_1484_11` for 2004, `API` for 1.2), falls back to the other, and maps every write to whichever
it bound:

| | SCORM 1.2 | SCORM 2004 |
|---|---|---|
| score | `cmi.core.score.raw/min/max` | `cmi.score.raw/min/max` + `cmi.score.scaled` |
| status | `cmi.core.lesson_status` | `cmi.completion_status` + `cmi.success_status` |
| time | `cmi.core.session_time` (HH:MM:SS.cc) | `cmi.session_time` (ISO 8601 duration) |
| close | `LMSFinish` | `Terminate` |

`LMSFinish`/`Terminate` fires on unload — not at grading — so retakes still report.

## SCORM Cloud smoke check

```bash
set SCORMCLOUD_APP_ID=your_app_id
set SCORMCLOUD_SECRET=your_secret
npm run smoke -- path\to\Course_SCORM12.zip
```

Uploads the zip, polls the import job, asserts SCORM Cloud's classification matches the package
(`SCORM_12`, or `SCORM_2004_*` for `*_SCORM2004.zip` — inferred from the filename, override with
`EXPECT_STANDARD=regex`), then deletes the course (set `KEEP_COURSE=1` to keep it for manual
preview at cloud.scorm.com). App credentials: cloud.scorm.com → Apps/API.

## Architecture

```
src/lib/        pure, unit-tested core — no DOM
  excel.ts        sheet → questions + problems/warnings (all resolution rules live here)
  scoring.ts      isScorable (export-gate truth) + presentedCount (draw/banks)
  rich.ts         markdown subset → safe HTML (shared by editor preview and player)
  theme.ts        theme validation, WCAG color math, CSS override block, logo → data URI
  captions.ts     SRT → WebVTT (converted once, at attach time)
  template.ts     course ↔ template JSON (media stripped into a re-attach manifest)
  manifest.ts     imsmanifest.xml (SCORM 1.2 + 2004 4th Ed)
  deck.ts         Course → Deck (export assets/ paths | preview object URLs; field whitelists
                  for questions AND blocks — projectQuestion/projectBlocks)
  player.ts       deck → player HTML (single source of truth for preview AND export)
  packager.ts     manifest + player + assets → zip; export blockers; transformVideo hook
  compress.ts     export-time video re-encode (WebCodecs, browser-only; declines → original ships)
  batch.ts        filename series grouping (video/image/audio/doc/captions/quiz per number)
  suspend.ts      suspend_data size estimate/warning (per-type worst cases)
  db.ts           IndexedDB (project JSON + media blobs, registry-driven orphan GC)
src/player/     player-template.html (inlined SCORM wrapper + runtime + theme slot)
src/components/ Rail / Canvas / BlocksEditor / Inspector / PreviewModal / BatchPane / ui
src/state.tsx   course reducer + IndexedDB autosave
scripts/        scorm-cloud-smoke.mjs · e2e.ts
```

Media blobs never sit in React state — pages hold `MediaRef`s (registry: `PAGE_MEDIA_KINDS` +
`blockMediaRefs` in [src/lib/types.ts](src/lib/types.ts) — GC, preview and packaging all enumerate
them, so no media kind, page-level or block-held, can be silently garbage-collected); blobs stream
out of IndexedDB for playback and packaging. Large-file warnings at 200 MB/file and 800 MB/course.

## Templates

**Save template** downloads the course structure as `<title>.template.json` — pages, quizzes,
blocks, settings and theme, with all media blobs stripped into a manifest. **Load** replaces the
current course (with an explicit confirm — the old course's media is then garbage-collected) and
lists exactly which files to re-attach ("R_005.mp4, page 1 video"). Page IDs are regenerated on
load, so re-using a template never collides. A full backup format including media would need a zip
container and is deferred.

## Roadmap / deliberately not built

- xAPI (Tin Can) export — designed (tincan.xml + runtime adapter sharing the SCORM wrapper's
  method surface, State-API resume) but **deferred by decision 2026-07-17**: the current LMS
  workflow is SCORM-only.
- True skip-logic branching — conflicts with single-SCO whole-course scoring; restricted
  navigation + fail-remediation (shipped) cover the practical need.
- Full-media backup files (zip container) and block completion gating ("must open every
  accordion") — future candidates.
- Cloud-saved projects (Express/Drizzle/Postgres) — v1 is deliberately serverless.
