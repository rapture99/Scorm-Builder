import { describe, it, expect } from 'vitest'
import { extractSeriesKey, groupBatchFiles, defaultGroupTitle } from './batch'

const f = (name: string) => ({ name })

describe('extractSeriesKey', () => {
  it('takes the last digit run of the basename', () => {
    expect(extractSeriesKey('R_005.mp4')).toBe('005')
    expect(extractSeriesKey('E_005.png')).toBe('005')
    expect(extractSeriesKey('A_005.xlsx')).toBe('005')
    expect(extractSeriesKey('module2_take3.mp4')).toBe('3')
  })

  it('ignores digits in the extension', () => {
    expect(extractSeriesKey('video_12.mp4')).toBe('12')
  })

  it('returns null when the name has no digits', () => {
    expect(extractSeriesKey('intro.mp4')).toBeNull()
  })
})

describe('groupBatchFiles', () => {
  it('groups a numbered series into {video, image, quiz} triples', () => {
    const { groups, skipped } = groupBatchFiles([
      f('R_005.mp4'), f('E_005.png'), f('A_005.xlsx'),
      f('R_006.mp4'), f('E_006.png'), f('A_006.xlsx'),
    ])
    expect(skipped).toHaveLength(0)
    expect(groups).toHaveLength(2)
    expect(groups[0].key).toBe('005')
    expect(groups[0].video!.name).toBe('R_005.mp4')
    expect(groups[0].image!.name).toBe('E_005.png')
    expect(groups[0].quiz!.name).toBe('A_005.xlsx')
    expect(groups[1].key).toBe('006')
  })

  it('sorts groups numerically', () => {
    const { groups } = groupBatchFiles([f('R_10.mp4'), f('R_2.mp4')])
    expect(groups.map((g) => g.key)).toEqual(['2', '10'])
  })

  it('records conflicts instead of silently overwriting', () => {
    const { groups } = groupBatchFiles([f('R_005.mp4'), f('X_005.mp4')])
    expect(groups).toHaveLength(1)
    expect(groups[0].video!.name).toBe('R_005.mp4')
    expect(groups[0].conflicts).toHaveLength(1)
    expect(groups[0].conflicts[0]).toContain('X_005.mp4')
  })

  it('skips unsupported types and unnumbered files with reasons', () => {
    const { groups, skipped } = groupBatchFiles([f('notes_005.txt'), f('intro.mp4'), f('R_007.mp4')])
    expect(groups).toHaveLength(1)
    expect(skipped).toHaveLength(2)
    expect(skipped.find((s) => s.name === 'notes_005.txt')!.reason).toContain('unsupported')
    expect(skipped.find((s) => s.name === 'intro.mp4')!.reason).toContain('no series number')
  })

  it('partial groups are allowed (video-only item)', () => {
    const { groups } = groupBatchFiles([f('R_008.mp4')])
    expect(groups[0].quiz).toBeUndefined()
    expect(groups[0].image).toBeUndefined()
  })

  it('caption files land in the captions slot (extension-routed, any prefix)', () => {
    const { groups } = groupBatchFiles([f('R_005.mp4'), f('V_005.vtt')])
    expect(groups).toHaveLength(1)
    expect(groups[0].captions!.name).toBe('V_005.vtt')
    // an .srt sharing the video's basename groups fine — kinds differ
    const srt = groupBatchFiles([f('R_006.mp4'), f('R_006.srt')])
    expect(srt.groups[0].captions!.name).toBe('R_006.srt')
    // two caption files for one key = conflict
    const dup = groupBatchFiles([f('V_007.vtt'), f('C_007.srt')])
    expect(dup.groups[0].conflicts).toHaveLength(1)
  })
})

describe('defaultGroupTitle', () => {
  it('prefers the quiz basename — A_005.xlsx names the package A_005', () => {
    const { groups } = groupBatchFiles([f('R_005.mp4'), f('A_005.xlsx')])
    expect(defaultGroupTitle(groups[0])).toBe('A_005')
  })

  it('falls back to video basename', () => {
    const { groups } = groupBatchFiles([f('R_008.mp4')])
    expect(defaultGroupTitle(groups[0])).toBe('R_008')
  })
})
