import { useCallback } from 'react'
import { fileKind } from './lib/files'
import { srtToVtt } from './lib/captions'
import { parseQuizWorkbook } from './lib/excel'
import { putMedia, totalMediaBytes, WARN_FILE_BYTES, WARN_TOTAL_BYTES } from './lib/db'
import { newPage, useDispatch, useEditor } from './state'
import { useToast } from './toast'

const MB = 1024 * 1024
const fmtMB = (b: number) => `${Math.round(b / MB)} MB`

/**
 * The universal drop target's brain: route files by extension onto a page
 * (mp4→video, png/jpg→image, xlsx/csv→quiz). Creates a page when none exists.
 */
export function useAttachFiles() {
  const dispatch = useDispatch()
  const { course, selectedId } = useEditor()
  const toast = useToast()

  return useCallback(
    async (incoming: Iterable<File>, targetPageId?: string) => {
      const files = Array.from(incoming)
      if (!files.length) return

      let pageId = targetPageId ?? selectedId
      if (!pageId || !course.pages.some((p) => p.id === pageId)) {
        const p = newPage(course.pages.length + 1)
        dispatch({ type: 'addPage', page: p })
        pageId = p.id
      }

      const KIND_LABEL = { video: 'Video', image: 'Image', audio: 'Audio', doc: 'Document' } as const
      let addedBytes = 0
      for (const f of files) {
        const kind = fileKind(f.name)
        if (kind === 'video' || kind === 'image' || kind === 'audio' || kind === 'doc') {
          if (f.size > WARN_FILE_BYTES) {
            toast(`${f.name} is ${fmtMB(f.size)} — large files slow packaging and playback`, 'warn')
          }
          const mediaId = crypto.randomUUID()
          try {
            await putMedia(mediaId, f)
          } catch (err) {
            toast(`Could not store ${f.name}: ${(err as Error).message}`, 'err')
            continue
          }
          addedBytes += f.size
          dispatch({
            type: 'setMedia', id: pageId, kind,
            ref: { mediaId, name: f.name, size: f.size, type: f.type },
          })
          toast(`${KIND_LABEL[kind]} attached: ${f.name}`)
        } else if (kind === 'captions') {
          // SRT converts to canonical WebVTT here, once — export and preview then serve the blob as-is
          let blob: Blob = f
          let name = f.name
          if (/\.srt$/i.test(f.name)) {
            blob = new Blob([srtToVtt(await f.text())], { type: 'text/vtt' })
            name = f.name.replace(/\.srt$/i, '.vtt')
          }
          const mediaId = crypto.randomUUID()
          try {
            await putMedia(mediaId, blob)
          } catch (err) {
            toast(`Could not store ${f.name}: ${(err as Error).message}`, 'err')
            continue
          }
          dispatch({
            type: 'setMedia', id: pageId, kind: 'captions',
            ref: { mediaId, name, size: blob.size, type: 'text/vtt' },
          })
          const hasVideo = course.pages.find((p) => p.id === pageId)?.video
          toast(`Captions attached: ${name}${hasVideo ? '' : ' — attach a video to use them'}`)
        } else if (kind === 'quiz') {
          const parsed = parseQuizWorkbook(await f.arrayBuffer(), f.name)
          if (parsed.fatal) {
            toast(`${f.name}: ${parsed.fatal}`, 'err')
            continue
          }
          // spread-through (minus `fatal`) so new Quiz fields — draw, banks, warnings — survive
          const { fatal: _fatal, ...quiz } = parsed
          dispatch({ type: 'setQuiz', id: pageId, quiz })
          if (parsed.problems.length) {
            toast(`${parsed.problems.length} answer(s) unmatched in ${f.name} — see inspector. Export is blocked until fixed.`, 'err')
          } else {
            toast(`${parsed.questions.length} questions loaded from ${f.name} — all answers matched`)
          }
        } else {
          toast(`Unsupported file type: ${f.name}`, 'err')
        }
      }

      const total = totalMediaBytes(course) + addedBytes
      if (total > WARN_TOTAL_BYTES) {
        toast(`Course media totals ${fmtMB(total)} — packaging happens in the browser and may fail past ~1 GB`, 'warn')
      }
    },
    [course, selectedId, dispatch, toast],
  )
}
