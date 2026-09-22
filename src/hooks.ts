import { useEffect, useState } from 'react'
import type { MediaRef } from './lib/types'
import { getMedia } from './lib/db'

/**
 * Object URL for a media blob, streamed out of IndexedDB on demand — blobs
 * never live in React state. Revokes on unmount/ref change.
 */
export function useMediaUrl(ref: MediaRef | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const mediaId = ref?.mediaId

  useEffect(() => {
    if (!mediaId) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let alive = true
    getMedia(mediaId).then((blob) => {
      if (!blob) return
      objectUrl = URL.createObjectURL(blob)
      if (alive) setUrl(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [mediaId])

  return url
}
