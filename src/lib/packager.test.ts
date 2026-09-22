import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildScormPackage, findExportBlockers, blockerMessage, packageFileName } from './packager'
import type { Course, MediaRef } from './types'

function ref(name: string): MediaRef {
  return { mediaId: `id-${name}`, name, size: 3, type: 'application/octet-stream' }
}

const getBlob = async (_r: MediaRef) => new Blob(['abc'])

function course(overrides: Partial<Course> = {}): Course {
  return {
    title: 'A_005',
    passMark: 70,
    scormVersion: '1.2',
    pages: [
      {
        id: 'p1',
        title: 'Item 005',
        body: '',
        video: ref('R_005.mp4'),
        image: ref('E_005.png'),
        quiz: {
          sourceName: 'A_005.xlsx',
          problems: [],
          questions: [{ n: 1, q: 'Q?', o: ['yes', 'no'], c: [0], t: 'MCQ' }],
        },
      },
    ],
    ...overrides,
  }
}

describe('buildScormPackage — zip layout', () => {
  it('puts imsmanifest.xml at the ARCHIVE ROOT, never nested', async () => {
    const { blob } = await buildScormPackage(course(), getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)

    expect(names).toContain('imsmanifest.xml')
    expect(names).toContain('index.html')
    // nothing may sit inside a wrapper directory
    for (const n of names) {
      expect(n.startsWith('assets/') || !n.includes('/'), `unexpected nesting: ${n}`).toBe(true)
    }
  })

  it('manifest lists exactly the files that exist in the zip', async () => {
    const { blob } = await buildScormPackage(course(), getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const manifest = await zip.file('imsmanifest.xml')!.async('string')
    const listed = [...manifest.matchAll(/<file href="([^"]+)"\/>/g)].map((m) => m[1])
    const actual = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== 'imsmanifest.xml')
    expect(listed.sort()).toEqual(actual.sort())
  })

  it('embeds the deck with assets/ paths in the player', async () => {
    const { blob } = await buildScormPackage(course(), getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const html = await zip.file('index.html')!.async('string')
    const m = html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    const deck = JSON.parse(m![1])
    expect(deck.pages[0].video.src).toBe('assets/p1_R_005.mp4')
    expect(deck.pages[0].image.src).toBe('assets/p1_E_005.png')
    expect(deck.pages[0].quiz.questions[0].c).toEqual([0])
  })

  it('dedupes colliding asset filenames across pages', async () => {
    const c = course()
    c.pages.push({ id: 'p2', title: 'Page 2', body: '', video: ref('R_005.mp4'), image: null, quiz: null })
    // both pages carry R_005.mp4; page prefix (p1_/p2_) already separates them —
    // force a true collision via identical names on the same page prefix
    c.pages[1].image = { ...ref('R_005.mp4') }
    const { blob } = await buildScormPackage(c, getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const assetNames = Object.keys(zip.files).filter((n) => n.startsWith('assets/') && !zip.files[n].dir)
    expect(new Set(assetNames).size).toBe(assetNames.length)
    expect(assetNames).toContain('assets/p2_R_005.mp4')
    expect(assetNames).toContain('assets/p2_R_005_2.mp4')
  })

  it('names the zip after the course title and SCORM version', () => {
    expect(packageFileName('A_005', '1.2')).toBe('A_005_SCORM12.zip')
    expect(packageFileName('My Fire Safety Course', '1.2')).toBe('My_Fire_Safety_Course_SCORM12.zip')
    expect(packageFileName('A_005', '2004')).toBe('A_005_SCORM2004.zip')
  })

  it('a 2004 course ships a 2004 manifest and a 2004-targeted player', async () => {
    const { blob, fileName } = await buildScormPackage(course({ scormVersion: '2004' }), getBlob)
    expect(fileName).toBe('A_005_SCORM2004.zip')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const manifest = await zip.file('imsmanifest.xml')!.async('string')
    expect(manifest).toContain('<schemaversion>2004 4th Edition</schemaversion>')
    expect(manifest).toContain('adlcp:scormType="sco"')
    const html = await zip.file('index.html')!.async('string')
    // player binds the 2004 API first and carries the version in the deck
    expect(html).toContain("(window,'2004')")
    expect(JSON.parse(html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)![1]).scormVersion).toBe('2004')
  })
})

describe('video transform hook', () => {
  const deckJson = (html: string) =>
    JSON.parse(html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)![1])

  it('ships the transformed blob under its new name — zip, manifest and deck all agree', async () => {
    const c = course()
    c.pages[0].video = ref('R_005.mov')
    const { blob } = await buildScormPackage(c, getBlob, {
      transformVideo: async (_b, r) => ({ blob: new Blob(['tiny-h264']), name: r.name.replace(/\.mov$/, '.mp4') }),
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('assets/p1_R_005.mp4')).not.toBeNull()
    expect(zip.file('assets/p1_R_005.mov')).toBeNull()
    expect(await zip.file('assets/p1_R_005.mp4')!.async('string')).toBe('tiny-h264')
    const manifest = await zip.file('imsmanifest.xml')!.async('string')
    expect(manifest).toContain('assets/p1_R_005.mp4')
    expect(manifest).not.toContain('R_005.mov')
    expect(deckJson(await zip.file('index.html')!.async('string')).pages[0].video.src).toBe('assets/p1_R_005.mp4')
  })

  it('a null transform ships the original bytes under the original name', async () => {
    const { blob } = await buildScormPackage(course(), getBlob, { transformVideo: async () => null })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('assets/p1_R_005.mp4')!.async('string')).toBe('abc')
  })

  it('only video refs are offered to the transform — never images', async () => {
    const seen: string[] = []
    await buildScormPackage(course(), getBlob, {
      transformVideo: async (_b, r) => {
        seen.push(r.name)
        return null
      },
    })
    expect(seen).toEqual(['R_005.mp4'])
  })
})

describe('fail-loud export blocking', () => {
  it('throws, naming the offending page and question, when an answer is unresolved', async () => {
    const c = course()
    c.pages[0].quiz!.questions.push({ n: 9, q: 'Broken?', o: ['x', 'y'], c: [], t: 'MCQ' })
    await expect(buildScormPackage(c, getBlob)).rejects.toThrow(/Page 1 \("Item 005"\) · Q9/)
  })

  it('findExportBlockers reports every unscorable question', () => {
    const c = course()
    c.pages[0].quiz!.questions.push({ n: 9, q: 'Broken?', o: ['x'], c: [], t: 'MCQ' })
    c.pages.push({
      id: 'p2', title: '', body: '',
      quiz: { sourceName: 's.xlsx', problems: [], questions: [{ n: 'B2', q: '?', o: [], c: [], t: 'MCQ' }] },
    })
    const blockers = findExportBlockers(c)
    expect(blockers).toHaveLength(2)
    expect(blockerMessage(blockers)).toContain('Q9')
    expect(blockerMessage(blockers)).toContain('QB2')
    expect(blockerMessage(blockers)).toContain('Page 2')
  })

  it('refuses to export an empty course', async () => {
    await expect(buildScormPackage(course({ pages: [] }), getBlob)).rejects.toThrow(/no pages/)
  })

  it('new types gate on their own answer fields, not on c', () => {
    const c = course()
    c.pages[0].quiz!.questions = [
      { n: 1, q: 'ok fib', o: [], c: [], t: 'FIB', a: ['speed'] },
      { n: 2, q: 'ok num', o: [], c: [], t: 'NUM', num: { v: 225, tol: 0 } },
      { n: 3, q: 'bad fib', o: [], c: [], t: 'FIB' },
    ]
    const blockers = findExportBlockers(c)
    expect(blockers).toHaveLength(1)
    expect(blockers[0].questionN).toBe(3)
  })

  it('a themed course embeds the override CSS and the logo data URI — no extra asset', async () => {
    const c = course({
      theme: {
        scheme: 'light', primary: '#aa1122', font: 'sans',
        logo: { mediaId: 'logo-1', name: 'logo.png', size: 3, type: 'image/png' },
      },
    })
    const { blob } = await buildScormPackage(c, getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const html = await zip.file('index.html')!.async('string')
    expect(html).toContain('<style id="theme">:root{--teal:#aa1122')
    const deck = JSON.parse(html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)![1])
    expect(deck.theme.logoDataUri).toMatch(/^data:/)
    // the logo travels inside the deck JSON, never as a packaged file
    const assetNames = Object.keys(zip.files).filter((n) => n.startsWith('assets/') && !zip.files[n].dir)
    expect(assetNames.some((n) => n.includes('logo'))).toBe(false)
  })

  it('audio and pdf assets land in the zip, the manifest and the deck', async () => {
    const c = course()
    c.pages[0].audio = ref('N_005.mp3')
    c.pages[0].doc = ref('S_005.pdf')
    const { blob } = await buildScormPackage(c, getBlob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('assets/p1_N_005.mp3')).not.toBeNull()
    expect(zip.file('assets/p1_S_005.pdf')).not.toBeNull()
    const manifest = await zip.file('imsmanifest.xml')!.async('string')
    expect(manifest).toContain('assets/p1_N_005.mp3')
    expect(manifest).toContain('assets/p1_S_005.pdf')
    const html = await zip.file('index.html')!.async('string')
    const deck = JSON.parse(html.match(/<script id="DECK" type="application\/json">([\s\S]*?)<\/script>/)![1])
    expect(deck.pages[0].audio.src).toBe('assets/p1_N_005.mp3')
    expect(deck.pages[0].doc).toEqual({ src: 'assets/p1_S_005.pdf', name: 'S_005.pdf' })
  })

  it('a blocked question inside an undrawn bank subset still blocks export', () => {
    const c = course()
    c.pages[0].quiz!.bd = [1] // draw 1 of the 2 bank questions — the broken one may never be drawn
    c.pages[0].quiz!.questions = [
      { n: 1, q: 'fine', o: ['a', 'b'], c: [0], t: 'MCQ', b: 0 },
      { n: 2, q: 'broken', o: ['a', 'b'], c: [], t: 'MCQ', b: 0 },
    ]
    expect(findExportBlockers(c)).toHaveLength(1)
  })
})
