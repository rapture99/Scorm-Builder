/**
 * SRT → WebVTT conversion, done ONCE at attach time so the stored blob is
 * canonical text/vtt — export zips it byte-for-byte and preview serves it via
 * object URL with zero special-casing downstream. Cue numbers are kept (they
 * are valid VTT identifiers).
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(new RegExp('^' + String.fromCharCode(0xfeff)), '') // strip BOM
    .replace(/\r\n?/g, '\n')
    // 00:00:01,600 → 00:00:01.600 (SRT allows 1–2 digit hours)
    .replace(/(\d+:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return 'WEBVTT\n\n' + body.trim() + '\n'
}
