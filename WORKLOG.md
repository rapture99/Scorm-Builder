# Worklog

## 2026-07-17 — Tier 2 "Rise-class" interactive content

Approved plan shipped in eight milestones. Tests 200 → 239 across 17 files; `tsc` clean;
production build green; unified offline e2e (`npx vite-node scripts/e2e.ts`, 14 assertions,
supersedes e2e-tier1.ts). User decisions honored: no true skip-logic branching (single-SCO scoring
conflict — restricted nav + fail-remediation instead), templates are structure-only JSON.

- **Interactive content blocks** (`Page.blocks`): accordion, tabs, flashcards, click-to-reveal,
  timeline, image hotspots (click-to-place %-anchored markers). Authored in a new BlocksEditor
  (Canvas), projected via a `projectBlocks` whitelist in deck.ts (bodies through renderRichText,
  editor ids stripped, empty blocks dropped), rendered by a delegated vanilla runtime that only
  toggles ARIA attributes — never re-renders, never persists. Blocks are presentation-only:
  suspend_data provably untouched (tripwire test toggles everything and asserts byte-identical
  resume state). Hotspot images joined the GC registry via `blockMediaRefs` BEFORE any UI existed.
- **Restricted navigation** (`Course.navMode`): Next + forward dots lock until `pageReady`
  (media consumed AND questions answered — stricter than `pageDone`, which keeps driving dot
  coloring); backward always free; post-grade review roams; resume clamps to the first unfinished
  page. Batch inherits it. **Fail remediation** (`Course.onFailPageId` → deck index): results
  screen gains "Review the material" on fail; deletePage clears the pointer; stale ids drop the
  deck field.
- **Video captions**: `.vtt`/`.srt` routed as a new media kind (registry-covered), SRT→WebVTT
  converted once at attach (`captions.ts`), shipped as `<track default>` only when a video exists.
  Batch groups caption files by the same trailing-digit key.
- **Accessibility pass** (player): main/nav landmarks, dialog roles + focus management + shared
  Tab trap for the result card and lightbox (which gained a visible ✕), Escape closes both,
  polite live region announces page changes and grades, labeled dots (aria-current) and chips,
  decorative glyphs hidden, focus-visible styles on every control. Dialog elements are captured at
  boot so re-boots (tests) can't cross-talk. Non-goals documented: no WCAG conformance claim.
- **Course templates**: Save template → `<title>.template.json` (media stripped into a manifest of
  what to re-attach); Load validates the envelope (specific errors), regenerates page ids, remaps
  onFailPageId, confirms the destructive replace, then lists media to re-attach. Composes with
  migrateCourse.
- Rail chips now show audio/doc/captions/blocks (closing a Tier-1 gap).

⚠ Re-export existing packages to pick up the new player. SCORM Cloud smoke STILL pending credentials.

## 2026-07-17 — Tier 1 "Articulate-class" feature set

Everything from the approved Tier 1 plan, in eight milestones (xAPI export explicitly deferred —
user decision, SCORM-only workflow). Tests 98 → 200 across 15 files; `tsc` clean; production build
green; offline end-to-end check added (`npx vite-node scripts/e2e-tier1.ts`, 17 assertions on a
real generated workbook → parsed → packaged → zip inspected). Sample workbook exercising every
feature ships at `Tier1_Sample_A_101.xlsx`.

- **4 new question types** (declared-only in the sheet, never inferred — legacy A_-series sheets
  parse byte-for-byte, pinned by a golden test): FIB (`speed|her speed`, ≤80 chars, normalized),
  NUM (`225` · `1.5 ± 0.2` · `40..44` + Tolerance column), MAT (`Port = Left side` pairs in option
  cells, graded by right-text equality so duplicate rights are fair), SEQ (▲/▼ reorder; answer
  `C, A, D, B`/`CADB`/`3142`; order-preserving resolver, never sorted). Options grew A–F.
- **Per-question feedback** (Feedback / Correct Feedback / Incorrect Feedback columns) shown in
  review; **result-card summary chips** (`P2·Q7 ✓/✗`) that jump back to the question.
- **Attempts limit** (course setting; Retake disables at the cap, survives resume via `at`).
- **Seeded shuffle & random draw**: one 31-bit `sd` in suspend_data drives question order, option
  order (per-row Shuffle override; TF exempt; "All/None of the above" pinned), bankless Draw N-of-M
  and per-bank draws (Bank/Draw columns). Answers stay in canonical index space — grading is
  permutation-proof; retake re-rolls the seed. suspend format: `{a,w,sub,cp,sd,at}`.
- **Rich text bodies**: zero-dep markdown subset (`rich.ts`, sanitized by construction, XSS test
  suite) parsed at build time → `DeckPage.bodyHtml`; Canvas gained a toolbar + live preview using
  the same renderer. No `_underscore_` emphasis, deliberately — R_005-style names must not italicize.
- **Audio + PDF pages**: new media kinds end-to-end (drop routing, editor slots, batch groups,
  packaging). `w` is now a per-page bitmask (video=1, audio=2, doc=4; legacy `w[i]=1` still
  restores). Audio gates completion like video (95%/ended); PDFs render in an iframe with an
  always-visible download link and mark viewed-on-open.
- **Theming**: dark/light scheme, accent color with WCAG-luminance contrast handling, font stacks,
  logo as data URI inside the deck (works identically in preview/export/batch — batch's blob
  resolver falls back to IndexedDB for it). Template palette fully var-ified + `<style id="theme">`
  injection; unthemed output stays byte-identical (pinned by test).
- **Landmines fixed**: `migrateCourse` no longer clobbers unknown question types to MCQ on load;
  orphan-GC now enumerates a single `PAGE_MEDIA_KINDS` registry (+ theme logo) so new media kinds
  can't be silently pruned; deck projection is one shared whitelist for preview AND export; export
  gate is type-aware (`isScorable`) — a broken question in an undrawn bank subset still blocks.

⚠ Re-export existing packages to pick up the new player. SCORM Cloud smoke still pending credentials.

## 2026-07-17 — Video download deterrence + export-time video compression

**Player: no video downloads.** The exported player's `<video>` now carries
`controlslist="nodownload"` (strips Chromium's ⋮ Download control) and `disablepictureinpicture`,
and the context menu is blocked on the video element only — that menu is where Chrome's and
Firefox's "Save video as…" live. The rest of the page keeps its context menu. This is deterrence
for honest users, not DRM — the file is still in the zip and fetchable by anyone with devtools.

**Packaging: videos are compressed on export** (editor + batch, same pipeline):
- New `src/lib/compress.ts` re-encodes with the browser's own hardware codecs — WebCodecs via
  **mediabunny** (new dep, MPL-2.0, lazy-loaded so editor startup doesn't pay for it). Output:
  H.264 MP4, longest edge capped at 1280px (never upscales), bitrate ≈ 0.09 bits/px @30fps
  (~2.5 Mbps at 720p), audio copied bit-for-bit (never re-encoded).
- `buildScormPackage` gained an optional `transformVideo` hook, run **before** deck/manifest
  build so a renamed file (`.mov`/`.webm` → `.mp4`) flows into assets/, the manifest and the
  player deck consistently. Core stays DOM-free; the UI call sites inject the compressor.
- **Every failure ships the original**: no WebCodecs (Firefox/Safari gaps, tests), source under
  4 MB, source already at/below the target bitrate, a track the browser can't carry over (would
  silently strip audio), conversion error, or savings under 15%. Export never breaks because
  compression couldn't help.
- Progress surfaces in the UI: the editor's export button and batch's busy line show
  "Compressing <file>… N%".

Tests 91 → 98 (transform hook: rename lands in zip+manifest+deck, null transform keeps original,
images never offered; compressor fallback contract; player download-deterrence). ⚠ Re-export
existing packages to pick up the new player. SCORM Cloud smoke still pending credentials.

## 2026-07-17 — SCORM 2004 (4th Edition) export

The inspector's SCORM version toggle is now live: 1.2 (default, widest LMS support) or
2004 4th Edition. Batch mode follows the same setting. What changes per version:

- **Manifest**: 1.2 keeps `adlcp:masteryscore`; 2004 emits CAM 1.3 namespaces with an imsss
  primary objective (`satisfiedByMeasure`, `minNormalizedMeasure` = passMark/100) and the
  `adlcp:scormType` casing.
- **Player**: one inline wrapper speaks both dialects — hunts the packaged version's API object
  first (`API_1484_11` vs `API`), falls back to the other, and maps writes accordingly
  (score.raw/min/max + scaled, completion_status + success_status, ISO-8601 session_time on 2004).
  Terminate/LMSFinish still fires on unload only.
- **suspend_data ceiling**: per-version warning (4096 on 1.2, 64k on 2004); a 1.2 deck that
  outgrows the limit is told to split or switch to 2004.
- **Naming**: `*_SCORM2004.zip` vs `*_SCORM12.zip`; the smoke script infers the expected
  SCORM Cloud classification from the filename (`EXPECT_STANDARD=regex` overrides).

Tests 77 → 91 (2004 manifest, 2004 packaging, live LMS-API reporting tests for both dialects).
Reminder: the SCORM Cloud smoke check still hasn't run for either version — needs credentials.

## 2026-07-17 — MCA + True/False question types

Assessments now support three question types end-to-end (Excel → editor preview → exported player):
- **MCQ** — single answer, radios (as before).
- **MCA** — multiple correct answers, checkboxes, scored **all-or-nothing** (selected set must
  exactly equal the correct set). `Correct Answer` cell: `A, C` · `Paris; Berlin` · `AC` — every
  token resolved by the same exact-text-then-letter rule; any unresolvable token fails the whole
  cell (fail loud). Player shows "Select all that apply".
- **TF** — true/false radios. Case-insensitive True/False/T/F, Excel boolean cells handled, blank
  option columns auto-fill to True/False.

Type comes from the `Question Type` column (tolerant spellings; "Multiple Choice" ≠ MCA) or is
inferred (multi-answer cell → MCA, True/False options → TF). A declared MCQ/TF row listing several
answers is flagged as a problem — export blocked — rather than silently reinterpreted.

Model change: `Question.c` is now a **sorted integer index array** (`[]` = unresolved, blocks
export); runtime grading is integer set-equality. Old projects in IndexedDB are migrated on load
(`c: 2` → `[2]`). Tests grew from 54 → 77. Also hardened `scoreVal` rendering (`String(score)`).

⚠ Re-export existing packages to pick up the new player.



## 2026-07-16 — Initial build + video fixes

### App built from scratch (from the build brief; prototype used as mechanics reference only)

Stack: React 18 · Vite 6 · TypeScript (strict) · Tailwind 4 · SheetJS · JSZip · IndexedDB (`idb`).
Everything client-side, no server.

**Editor mode** — three-pane authoring:
- Left rail: page thumbnails, drag-to-reorder, add/delete, chips showing attached media (vid/img/quiz).
- Canvas: page title + body text, universal drop target routing by extension (mp4/webm/mov→video,
  png/jpg/webp→image, xlsx/xls/csv→quiz), click-to-browse fallback, media slots with remove buttons,
  quiz preview with correct answers highlighted.
- Inspector: pass mark, SCORM version (1.2 active, 2004 disabled), per-page quiz validation with
  unmatched-answer details, course summary, suspend-data and media-size warnings.
- Preview modal renders the EXACT exported player (single template feeds preview and export).
- Export → `<Title>_SCORM12.zip` download.

**Batch mode** — promoted from the brief's Phase 2 to a first-class tab:
- Drop a folder of numbered triples (`R_005.mp4`, `E_005.png`, `A_005.xlsx`) → grouped by the last
  digit run in the filename → one single-page package per number.
- Validation table (conflicts, bad sheets, unscorable questions block per-item), editable titles,
  per-row download or one bundle zip. Same pipeline as the editor.

**Prototype shortcuts fixed (all three from the brief):**
- Persistence: project + media blobs in IndexedDB; refresh loses nothing; orphaned blobs GC'd.
- Memory: blobs never sit in React state — streamed from IndexedDB on demand; warnings at
  200 MB/file and 800 MB/course.
- Tests: 54 across 8 files — Excel answer-resolution order, manifest generation, zip read-back
  (manifest at archive root, file list agreement, name dedupe), fail-loud export blocking,
  `</script>` injection safety, batch grouping, suspend-size guard, and DOM tests that boot the
  actual exported player (navigation, grading pass/fail, completion, retake, video markup).

**Correctness rules enforced + tested:**
- `imsmanifest.xml` always at the zip root (never nested).
- Correct answer resolution: exact full-text match → letter A–D fallback → integer index at build
  time; runtime compares integers only.
- Export blocks loudly, naming Page/Q, if any answer resolves to no option.
- suspend_data kept compact (`{a,w,sub,cp}`, index arrays); warning as decks approach the 4096-char
  SCORM 1.2 ceiling.
- Player improvement over the prototype: `LMSFinish` fires on unload, not at grade time
  (SCORM 1.2 ignores writes after finish — grade-time finish would break retake reporting).

**Also:** `scripts/scorm-cloud-smoke.mjs` (`npm run smoke -- <zip>`) — uploads to SCORM Cloud,
polls the import job, asserts SCORM_12 classification, cleans up. **Not yet run** — needs
`SCORMCLOUD_APP_ID` / `SCORMCLOUD_SECRET`. Real "done" = passing there.

### Reverted (requested by mistake, then rolled back)
Duplicate scenario-name validation (editor + batch) was implemented, then fully reverted on request.
Known cosmetic quirk left as-is: after deleting a page, "Add page" can mint a duplicate auto-title
like a second "Page 3" (harmless to SCORM output).

### Video fixes (exported player)
- **Blank video on first render**: the player injected `<video><source src>` via innerHTML, which
  browsers don't reliably start loading (blank until Prev/Next forced a re-render). Fixed: `src`
  set directly on the element, `preload="auto"`, explicit `video.load()` after every page render.
  Regression test added.
- **Video size**: now an 80vw × 80vh centered stage (80% of viewport width and height), video
  letterboxed on black inside; falls back to full-width below 820px. Assessment layout untouched.

⚠ Packages exported before these fixes contain the old player — re-export to pick them up.

### Commands
`npm run dev` (editor at localhost:5173) · `npm test` · `npm run build` · `npm run smoke -- <zip>`
