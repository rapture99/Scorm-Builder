import { useEffect, useState } from 'react'
import { pageMediaRefs, type Course } from '../lib/types'
import { buildPreviewDeck } from '../lib/deck'
import { buildPlayerHtml } from '../lib/player'
import { resolveDeckTheme } from '../lib/theme'
import { getMediaByRef } from '../lib/db'
import { Button } from './ui'

/**
 * Renders the EXACT exported player (same template, same builder) in an
 * iframe, with media served from object URLs instead of assets/ paths.
 */
export function PreviewModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const objectUrls: string[] = []
    let frameUrl: string | null = null
    let alive = true

    ;(async () => {
      const urlByMediaId = new Map<string, string>()
      for (const p of course.pages) {
        for (const ref of pageMediaRefs(p)) {
          if (!urlByMediaId.has(ref.mediaId)) {
            const blob = await getMediaByRef(ref)
            const u = URL.createObjectURL(blob)
            objectUrls.push(u)
            urlByMediaId.set(ref.mediaId, u)
          }
        }
      }
      const theme = await resolveDeckTheme(course.theme, getMediaByRef)
      const deck = buildPreviewDeck(course, (ref) => urlByMediaId.get(ref.mediaId) ?? '', theme)
      const html = buildPlayerHtml(deck)
      frameUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      objectUrls.push(frameUrl)
      if (alive) setSrc(frameUrl)
    })().catch((err) => {
      if (alive) setError((err as Error).message)
    })

    return () => {
      alive = false
      objectUrls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [course])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,9,13,.8)] p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] border border-line2 bg-panel shadow-[0_30px_80px_rgba(0,0,0,.6)]">
        <div className="flex h-12 items-center gap-3 border-b border-line bg-panel2 px-3.5">
          <span className="lbl flex-1">Preview — as learners will see it</span>
          <Button onClick={onClose}>Close</Button>
        </div>
        {error ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-[13px] text-bad">{error}</div>
        ) : src ? (
          <iframe src={src} title="Course preview" className="w-full flex-1 border-0 bg-ink" />
        ) : (
          <div className="grid flex-1 place-items-center font-mono text-[11px] text-dim">building preview…</div>
        )}
      </div>
    </div>
  )
}
