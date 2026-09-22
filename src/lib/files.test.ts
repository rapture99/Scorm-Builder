import { describe, it, expect } from 'vitest'
import { fileKind, sanitizeFilename, makeAssetNamer } from './files'

describe('fileKind routing', () => {
  it('routes by extension, case-insensitively', () => {
    expect(fileKind('a.MP4')).toBe('video')
    expect(fileKind('b.webm')).toBe('video')
    expect(fileKind('c.PNG')).toBe('image')
    expect(fileKind('d.jpeg')).toBe('image')
    expect(fileKind('e.xlsx')).toBe('quiz')
    expect(fileKind('f.csv')).toBe('quiz')
    expect(fileKind('z.txt')).toBe('unknown')
  })

  it('routes audio and pdf documents', () => {
    expect(fileKind('n.MP3')).toBe('audio')
    expect(fileKind('n.m4a')).toBe('audio')
    expect(fileKind('n.wav')).toBe('audio')
    expect(fileKind('n.ogg')).toBe('audio')
    expect(fileKind('spec.PDF')).toBe('doc')
  })

  it('routes caption files', () => {
    expect(fileKind('c.vtt')).toBe('captions')
    expect(fileKind('c.SRT')).toBe('captions')
  })
})

describe('sanitizeFilename', () => {
  it('replaces unsafe characters and collapses runs', () => {
    expect(sanitizeFilename('my video (final) v2.mp4')).toBe('my_video_final_v2.mp4')
    expect(sanitizeFilename('ü?.png')).toBe('_.png') // leading junk collapsed then trimmed
  })
})

describe('makeAssetNamer', () => {
  it('dedupes by inserting a counter before the extension', () => {
    const claim = makeAssetNamer()
    expect(claim('v.mp4')).toBe('v.mp4')
    expect(claim('v.mp4')).toBe('v_2.mp4')
    expect(claim('v.mp4')).toBe('v_3.mp4')
  })

  it('treats names case-insensitively (zip servers often do)', () => {
    const claim = makeAssetNamer()
    claim('Video.mp4')
    expect(claim('video.mp4')).toBe('video_2.mp4')
  })
})
