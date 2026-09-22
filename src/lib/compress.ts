import type { MediaRef } from './types'
import type { VideoTransform } from './packager'

/**
 * Export-time video compression: re-encode with the browser's own codecs
 * (WebCodecs, via mediabunny) to H.264 MP4, longest edge capped at 1280px,
 * bitrate targeted by output area. Audio is copied bit-for-bit, never
 * re-encoded. Every decision errs toward shipping the ORIGINAL file — no
 * WebCodecs (Firefox/Safari gaps, tests), an already-efficient source, a
 * track the browser can't read, a failed conversion, or a result that isn't
 * meaningfully smaller all fall back silently. Export must never break
 * because compression couldn't help.
 */

/** Longest output edge in px (720p-class for landscape sources). Never upscales. */
const MAX_EDGE = 1280
/** Sources below this size aren't worth the re-encode time. */
const MIN_BYTES = 4 * 1024 * 1024
/** Keep the re-encode only when it saves at least this fraction of the original size. */
const MIN_SAVING = 0.15

/** H.264 target: ~0.09 bits/pixel at 30fps ≈ 2.5 Mbps for 720p. */
function targetBitrate(w: number, h: number): number {
  return Math.round(w * h * 30 * 0.09)
}

function mp4Name(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '') + '.mp4'
}

export function supportsCompression(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
}

/**
 * Build the packager's transformVideo hook. `onProgress` receives the media
 * ref and a 0..1 fraction while a file is encoding.
 */
export function makeVideoCompressor(
  onProgress?: (ref: MediaRef, fraction: number) => void,
): VideoTransform {
  return async (blob, ref) => {
    if (!supportsCompression() || blob.size < MIN_BYTES) return null
    try {
      // lazy-loaded: only exports pay for the codec library, not editor startup
      const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } =
        await import('mediabunny')
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      if (!track || !track.displayWidth || !track.displayHeight) return null
      const duration = await input.computeDuration()
      if (!duration || !isFinite(duration)) return null

      const scale = Math.min(1, MAX_EDGE / Math.max(track.displayWidth, track.displayHeight))
      // H.264 wants even dimensions
      const width = Math.max(2, 2 * Math.round((track.displayWidth * scale) / 2))
      const height = Math.max(2, 2 * Math.round((track.displayHeight * scale) / 2))
      const bitrate = targetBitrate(width, height)

      // full-resolution source already at/below the target bitrate → nothing to gain
      if (scale === 1 && (blob.size * 8) / duration <= bitrate * 1.25) return null

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
      const conversion = await Conversion.init({
        input,
        output,
        video: { codec: 'avc', width, height, fit: 'contain', bitrate, forceTranscode: true },
        // audio: defaults — copied without re-encoding when the codec fits in MP4
      })
      // a dropped track (e.g. audio the browser can't carry over) would silently  C:\Users\nikhil.j\Downloads\NORM-THE SCORM Builder\WORKLOG.md
      // strip sound from the course — ship the original instead
      if (!conversion.isValid || conversion.discardedTracks.length) return null
      if (onProgress) conversion.onProgress = (p) => onProgress(ref, p)
      await conversion.execute()

      const out = output.target.buffer
      if (!out || out.byteLength >= blob.size * (1 - MIN_SAVING)) return null
      return { blob: new Blob([out], { type: 'video/mp4' }), name: mp4Name(ref.name) }
    } catch (err) {
      console.warn(`Video compression skipped for ${ref.name}:`, err)
      return null
    }
  }
}
