import { describe, it, expect } from 'vitest'
import { renderRichText } from './rich'

describe('renderRichText — grammar', () => {
  it('plain text becomes a paragraph; single newlines become <br>', () => {
    expect(renderRichText('hello')).toBe('<p>hello</p>')
    expect(renderRichText('line one\nline two')).toBe('<p>line one<br>line two</p>')
  })

  it('blank lines split paragraphs', () => {
    expect(renderRichText('a\n\nb')).toBe('<p>a</p><p>b</p>')
  })

  it('headings map # ## ### to h2 h3 h4 (page title is the h1)', () => {
    expect(renderRichText('# Big\n## Mid\n### Small')).toBe('<h2>Big</h2><h3>Mid</h3><h4>Small</h4>')
  })

  it('bullet and numbered lists group consecutive lines', () => {
    expect(renderRichText('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderRichText('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>')
    expect(renderRichText('* a\n* b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('inline: bold, italic, links, color', () => {
    expect(renderRichText('**b** and *i*')).toBe('<p><strong>b</strong> and <em>i</em></p>')
    expect(renderRichText('[docs](https://example.com/x?a=1&b=2)')).toBe(
      '<p><a href="https://example.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">docs</a></p>',
    )
    expect(renderRichText('[mail](mailto:a@b.co)')).toContain('href="mailto:a@b.co"')
    expect(renderRichText('{c:#e0a44a}warn{/c}')).toBe('<p><span style="color:#e0a44a">warn</span></p>')
  })

  it('underscores never italicize — R_005-style names stay intact', () => {
    expect(renderRichText('see R_005_SCORM12.zip and A_005.xlsx')).toBe('<p>see R_005_SCORM12.zip and A_005.xlsx</p>')
  })

  it('backslash escapes render the literal character', () => {
    expect(renderRichText('\\*not italic\\*')).toBe('<p>*not italic*</p>')
    expect(renderRichText('\\[not a link](https://x)')).toBe('<p>[not a link](https://x)</p>')
    expect(renderRichText('\\{c:#fff}plain\\{/c}')).toBe('<p>{c:#fff}plain{/c}</p>')
    expect(renderRichText('a \\\\ b')).toBe('<p>a \\ b</p>')
  })

  it('empty input renders nothing', () => {
    expect(renderRichText('')).toBe('')
    expect(renderRichText('\n\n')).toBe('')
  })
})

describe('renderRichText — sanitization (XSS)', () => {
  it('raw HTML renders as escaped text, never markup', () => {
    expect(renderRichText('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(renderRichText('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(renderRichText('<b>not bold</b>')).toBe('<p>&lt;b&gt;not bold&lt;/b&gt;</p>')
  })

  it('javascript: and data: links render as literal text', () => {
    const out = renderRichText('[x](javascript:alert(1)) [y](data:text/html;base64,x)')
    expect(out).not.toContain('<a ')
    expect(out).toContain('[x](javascript:alert(1))')
  })

  it('rejects non-hex color payloads (no CSS injection)', () => {
    expect(renderRichText('{c:red}x{/c}')).not.toContain('<span')
    expect(renderRichText('{c:#fff;background:url(x)}x{/c}')).not.toContain('<span')
    expect(renderRichText('{c:#12345}x{/c}')).not.toContain('<span') // 5 hex digits is invalid
  })

  it('quotes inside a link URL cannot escape the href attribute', () => {
    const out = renderRichText('[x](https://e.com/"onmouseover="alert(1))')
    // the quote is HTML-escaped before the link token is processed
    expect(out).not.toContain('"onmouseover')
  })

  it('label text inside a link stays escaped', () => {
    expect(renderRichText('[<b>x</b>](https://e.com)')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
