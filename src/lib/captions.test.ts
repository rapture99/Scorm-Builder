import { describe, it, expect } from 'vitest'
import { srtToVtt } from './captions'

describe('srtToVtt', () => {
  it('prepends the WEBVTT header and dots the timestamps', () => {
    const srt = '1\n00:00:01,600 --> 00:00:04,200\nHello sailor\n\n2\n00:00:05,000 --> 00:00:07,999\nSecond cue\n'
    const vtt = srtToVtt(srt)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:01.600 --> 00:00:04.200')
    expect(vtt).toContain('00:00:05.000 --> 00:00:07.999')
    expect(vtt).toContain('Hello sailor')
  })

  it('handles 1-digit hours, CRLF line endings and a BOM', () => {
    const srt = '﻿1\r\n0:00:01,600 --> 0:00:04,200\r\nText\r\n'
    const vtt = srtToVtt(srt)
    expect(vtt).not.toContain('﻿')
    expect(vtt).not.toContain('\r')
    expect(vtt).toContain('0:00:01.600 --> 0:00:04.200')
  })

  it('leaves commas in cue TEXT alone', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nWell, hello, there\n')
    expect(vtt).toContain('Well, hello, there')
  })

  it('is effectively idempotent for already-dotted timestamps', () => {
    const vtt = srtToVtt('1\n00:00:01.600 --> 00:00:04.200\nText\n')
    expect(vtt).toContain('00:00:01.600 --> 00:00:04.200')
  })
})
