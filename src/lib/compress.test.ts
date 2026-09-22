import { describe, it, expect } from 'vitest'
import { makeVideoCompressor, supportsCompression } from './compress'

// Real re-encoding needs WebCodecs (a browser); what CAN be guaranteed here is
// the fallback contract: without WebCodecs the compressor must decline (null)
// so the packager ships the original file — never throw, never block export.
describe('makeVideoCompressor fallback contract', () => {
  const ref = { mediaId: 'm1', name: 'R_005.mp4', size: 0, type: 'video/mp4' }

  it('this environment has no WebCodecs', () => {
    expect(supportsCompression()).toBe(false)
  })

  it('declines large blobs when WebCodecs is unavailable', async () => {
    const big = new Blob([new Uint8Array(8 * 1024 * 1024)])
    expect(await makeVideoCompressor()(big, ref)).toBeNull()
  })

  it('declines small blobs regardless (not worth the re-encode)', async () => {
    expect(await makeVideoCompressor()(new Blob(['x']), ref)).toBeNull()
  })
})
