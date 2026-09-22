/**
 * Zero-dependency rich text: a tiny markdown subset rendered to safe HTML.
 * The SAME function feeds the editor preview and the exported player (parsed
 * at deck-build time), so what you see is exactly what ships.
 *
 * Blocks (line-oriented):   # / ## / ### headings · - or * bullet lists ·
 * 1. numbered lists · blank line = paragraph break · single newline = <br>
 * Inline:                   **bold** · *italic* · [label](https://url) ·
 * {c:#hex}colored{/c} · backslash escapes \* \[ \{ \\
 * (No _underscore_ emphasis — filenames like R_005 must never italicize.)
 *
 * Sanitized BY CONSTRUCTION: every text run is HTML-escaped before any token
 * substitution, tags are only ever emitted by this renderer, link URLs must
 * match https/http/mailto, and color values must be a strict hex literal.
 * Raw HTML in the source therefore renders as visible text, never as markup.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// private-use sentinels that protect backslash-escaped characters during token substitution
const S_BSLASH = String.fromCharCode(0xe000)
const S_STAR = String.fromCharCode(0xe001)
const S_BRACKET = String.fromCharCode(0xe002)
const S_BRACE = String.fromCharCode(0xe003)

function inline(run: string): string {
  let s = escapeHtml(run)
  s = s.replace(/\\\\/g, S_BSLASH).replace(/\\\*/g, S_STAR).replace(/\\\[/g, S_BRACKET).replace(/\\\{/g, S_BRACE)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, url: string) =>
    /^(https?:\/\/|mailto:)/i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole,
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  // the validated hex literal is the ONLY thing interpolated into style
  s = s.replace(/\{c:(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\}([\s\S]*?)\{\/c\}/gi, '<span style="color:$1">$2</span>')
  return s
    .replace(new RegExp(S_BSLASH, 'g'), '\\')
    .replace(new RegExp(S_STAR, 'g'), '*')
    .replace(new RegExp(S_BRACKET, 'g'), '[')
    .replace(new RegExp(S_BRACE, 'g'), '{')
}

export function renderRichText(src: string): string {
  if (!src) return ''
  const lines = String(src).split(/\r?\n/)
  const out: string[] = []
  const para: string[] = []
  const flush = () => {
    if (para.length) {
      out.push('<p>' + para.map(inline).join('<br>') + '</p>')
      para.length = 0
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flush()
      const level = h[1].length + 1 // page title is the h1
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, '')))
        i++
      }
      i--
      out.push('<ul>' + items.map((x) => `<li>${x}</li>`).join('') + '</ul>')
      continue
    }
    if (/^\s*\d{1,3}\.\s+/.test(line)) {
      flush()
      const items: string[] = []
      while (i < lines.length && /^\s*\d{1,3}\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d{1,3}\.\s+/, '')))
        i++
      }
      i--
      out.push('<ol>' + items.map((x) => `<li>${x}</li>`).join('') + '</ol>')
      continue
    }
    para.push(line)
  }
  flush()
  return out.join('')
}
