export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a beat to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
