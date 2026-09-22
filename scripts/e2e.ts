/* Offline end-to-end pipeline check (Tier 1 + Tier 2):
   author (xlsx + blocks + captions + nav + theme) → parse → package → inspect zip → template round-trip.
   Run: npx vite-node scripts/e2e.ts */
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'
import { parseQuizWorkbook } from '../src/lib/excel'
import { buildScormPackage } from '../src/lib/packager'
import { estimateSuspendSize, suspendWarning } from '../src/lib/suspend'
import { serializeTemplate, deserializeTemplate } from '../src/lib/template'
import type { Course, MediaRef } from '../src/lib/types'

const rows = [
  ['Number', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F', 'Correct Answer', 'Question Type', 'Feedback', 'Correct Feedback', 'Incorrect Feedback', 'Tolerance', 'Shuffle', 'Bank', 'Draw'],
  [1, 'Which light shows a 225° arc?', 'Masthead', 'Stern', 'Port side', 'Starboard side', 'All-round', 'Towing', 'A', 'MCQ', 'See Rule 21.', '', '', '', 'yes', '', ''],
  [2, 'Which are give-way situations? (pick two)', 'Overtaking', 'Being overtaken', 'Crossing from port', 'Stand-on', '', '', 'A, C', 'MCA', '', 'Correct — Rules 13 & 15.', 'Revisit Rules 13 and 15.', '', '', '', ''],
  [3, 'Rule 5 requires a proper lookout at all times', '', '', '', '', '', '', 'True', 'T/F', '', '', '', '', '', '', ''],
  [4, 'The stand-on vessel shall maintain course and _____', '', '', '', '', '', '', 'speed|her speed', 'Fill in the blank', 'Rule 17(a)(i).', '', '', '', '', '', ''],
  [5, 'Minimum safe CPA in open water (nm)?', '', '', '', '', '', '', '1.5', 'Numeric', '', '', '', 0.5, '', '', ''],
  [6, 'Match the term to its meaning', 'Port = Left side', 'Starboard = Right side', 'Bow = Front of vessel', 'Stern = Back of vessel', '', '', '', 'Matching', '', '', '', '', '', '', ''],
  [7, 'Order the actions on hearing a fog signal', 'Reduce speed', 'Sound your signal', 'Post extra lookout', 'Log the event', '', '', 'C, A, B, D', 'Sequencing', '', '', '', '', '', '', ''],
  [8, 'Bank variant: day shape for vessel at anchor?', 'One black ball', 'Two cones', 'Cylinder', 'Diamond', '', '', 'A', 'MCQ', '', '', '', '', '', 'Shapes', '1'],
  [9, 'Bank variant: day shape for vessel constrained by draught?', 'One black ball', 'Two cones', 'Cylinder', 'Diamond', '', '', 'C', 'MCQ', '', '', '', '', '', 'Shapes', ''],
]

const ws = XLSX.utils.aoa_to_sheet(rows)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Quiz')
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

const parsed = parseQuizWorkbook(buf, 'Tier1_Sample_A_101.xlsx')
console.log('parse:', parsed.fatal ?? 'ok', '· problems:', parsed.problems.length, '· types:', parsed.questions.map((q) => q.t).join(','))
if (parsed.fatal || parsed.problems.length) throw new Error('sample sheet must parse clean')

const { fatal: _f, ...quiz } = parsed
const mref = (name: string, type: string): MediaRef => ({ mediaId: `m-${name}`, name, size: 9, type })
const course: Course = {
  title: 'E2E_Full_A_101',
  passMark: 70,
  scormVersion: '1.2',
  maxAttempts: 2,
  shuffleOptions: true,
  navMode: 'restricted',
  theme: { scheme: 'light', primary: '#7a1f2b', font: 'serif', logo: mref('logo.png', 'image/png') },
  pages: [
    {
      id: 'p1',
      title: 'COLREGS refresher',
      body: '# Welcome aboard\nThis short course covers **lights, shapes and conduct**.\n\n- Watch the briefing\n- Explore the diagram markers',
      video: mref('R_101.mp4', 'video/mp4'),
      captions: mref('R_101.vtt', 'text/vtt'),
      audio: mref('N_101.mp3', 'audio/mpeg'),
      doc: mref('S_101.pdf', 'application/pdf'),
      quiz: null,
      blocks: [
        { id: 'b1', kind: 'accordion', items: [{ id: 'i1', title: 'Rule 5', body: 'Keep a **proper lookout**.' }, { id: 'i2', title: 'Rule 6', body: 'Safe speed at all times.' }] },
        { id: 'b2', kind: 'tabs', items: [{ id: 'i3', title: 'Day', body: 'Shapes' }, { id: 'i4', title: 'Night', body: 'Lights' }] },
        { id: 'b3', kind: 'flashcards', cards: [{ id: 'c1', front: 'Port light color?', back: '*Red*' }] },
        { id: 'b4', kind: 'reveal', prompt: 'Show the mnemonic', body: 'Red Right Returning' },
        { id: 'b5', kind: 'timeline', items: [{ id: 't1', label: 'Step 1', title: 'Assess', body: 'Determine risk of collision' }] },
        { id: 'b6', kind: 'hotspots', image: mref('bridge.png', 'image/png'), spots: [{ id: 's1', x: 30, y: 40, title: 'Radar', body: 'X-band display' }] },
      ],
    },
    { id: 'p2', title: 'Assessment', body: '', quiz },
  ],
}
course.onFailPageId = 'p1'

console.log('suspend estimate:', estimateSuspendSize(course), 'chars · warning:', suspendWarning(course) ?? 'none')

const getBlob = async (ref: MediaRef) => new Blob([`fake-${ref.name}`], { type: ref.type })
const { blob, fileName } = await buildScormPackage(course, getBlob)
const zipPath = `C:/Users/nikhil.j/AppData/Local/Temp/claude/c--Users-nikhil-j-Downloads-NORM-THE-SCORM-Builder/d1e6517a-312a-42e1-a0e2-8776cb6f5f33/scratchpad/${fileName}`
writeFileSync(zipPath, Buffer.from(await blob.arrayBuffer()))

const zip = await JSZip.loadAsync(await blob.arrayBuffer())
const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
const html = await zip.file('index.html')!.async('string')
const deck = JSON.parse(html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)![1].replace(/<\\\//g, '</'))
const manifest = await zip.file('imsmanifest.xml')!.async('string')

// template round-trip on the same course
const tpl = JSON.stringify(serializeTemplate(course))
const loaded = deserializeTemplate(tpl)

const checks: [string, boolean][] = [
  // Tier 1 regression
  ['manifest at root', names.includes('imsmanifest.xml')],
  ['theme override + light palette', html.includes('<style id="theme">:root{--teal:') && html.includes('--bg:#f4f6f8')],
  ['rich text bodyHtml', /<h2>Welcome aboard<\/h2>/.test(deck.pages[0].bodyHtml)],
  ['all 7 question types in deck', deck.pages[1].quiz.questions.length === 9 && deck.pages[1].quiz.bd?.length === 1],
  ['maxAttempts + shuffle', deck.maxAttempts === 2 && deck.shuffle?.o === 1],
  // Tier 2
  ['all six block kinds projected', Array.isArray(deck.pages[0].blocks) && deck.pages[0].blocks.map((b: { kind: string }) => b.kind).join(',') === 'accordion,tabs,flashcards,reveal,timeline,hotspots'],
  ['block ids never ship', !JSON.stringify(deck.pages[0].blocks).includes('"id"')],
  ['block bodies rendered', JSON.stringify(deck.pages[0].blocks).includes('<strong>proper lookout</strong>')],
  ['hotspot image packaged + in manifest', names.includes('assets/p1_bridge.png') && manifest.includes('assets/p1_bridge.png')],
  ['captions on video + vtt packaged', deck.pages[0].video.captions === 'assets/p1_R_101.vtt' && names.includes('assets/p1_R_101.vtt')],
  ['restricted nav + onFailPage in deck', deck.navMode === 'restricted' && deck.onFailPage === 0],
  ['player runtime has blocks + a11y + remediation', html.includes('renderBlocks') && html.includes('aria-live') && html.includes('reviewFailBtn')],
  // templates
  ['template strips media, keeps structure', !tpl.includes('mediaId') && loaded.course.pages.length === 2 && loaded.media.length === 6],
  ['template regenerates ids + remaps onFailPageId', loaded.course.pages[0].id !== 'p1' && loaded.course.onFailPageId === loaded.course.pages[0].id],
]
let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}`)
  if (!ok) failed++
}
if (failed) throw new Error(`${failed} end-to-end checks failed`)
console.log(`\nEND-TO-END OK · ${fileName} (${names.length} zip entries)`)
