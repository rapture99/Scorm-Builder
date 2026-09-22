import { describe, it, expect } from 'vitest'
import { buildManifest, escapeXml } from './manifest'

describe('buildManifest — SCORM 1.2', () => {
  const xml = buildManifest({
    title: 'Safety & "Compliance" <Course>',
    passMark: 70,
    scormVersion: '1.2',
    files: ['index.html', 'assets/p1_video.mp4'],
    identifier: 'TEST',
  })

  it('declares SCORM 1.2', () => {
    expect(xml).toContain('<schema>ADL SCORM</schema>')
    expect(xml).toContain('<schemaversion>1.2</schemaversion>')
    expect(xml).toContain('xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"')
  })

  it('escapes the title everywhere it appears', () => {
    expect(xml).toContain('Safety &amp; &quot;Compliance&quot; &lt;Course&gt;')
    expect(xml).not.toContain('<Course>')
  })

  it('points the SCO resource at index.html with all files listed', () => {
    expect(xml).toContain('adlcp:scormtype="sco" href="index.html"')
    expect(xml).toContain('<file href="index.html"/>')
    expect(xml).toContain('<file href="assets/p1_video.mp4"/>')
  })

  it('carries the mastery score', () => {
    expect(xml).toContain('<adlcp:masteryscore>70</adlcp:masteryscore>')
  })

  it('is well-formed enough to round-trip a parser', () => {
    // cheap structural sanity: balanced open/close for the tags we emit
    for (const tag of ['manifest', 'organizations', 'organization', 'item', 'resources', 'resource', 'metadata']) {
      const opens = xml.split(`<${tag}`).length - 1
      const closes = xml.split(`</${tag}>`).length - 1
      const selfClosing = xml.split(`<${tag} `).join('').split('/>').length - 1
      expect(opens, `${tag} open/close balance`).toBeGreaterThanOrEqual(closes)
      expect(closes + selfClosing).toBeGreaterThanOrEqual(1)
    }
  })

  it('does not leak 2004 constructs into a 1.2 manifest', () => {
    expect(xml).not.toContain('imsss:')
    expect(xml).not.toContain('scormType=') // 2004 spells it with a capital T
  })
})

describe('buildManifest — SCORM 2004', () => {
  const xml = buildManifest({
    title: 'Safety & "Compliance" <Course>',
    passMark: 70,
    scormVersion: '2004',
    files: ['index.html', 'assets/p1_video.mp4'],
    identifier: 'TEST',
  })

  it('declares SCORM 2004 4th Edition with the CAM 1.3 namespaces', () => {
    expect(xml).toContain('<schema>ADL SCORM</schema>')
    expect(xml).toContain('<schemaversion>2004 4th Edition</schemaversion>')
    expect(xml).toContain('xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"')
    expect(xml).toContain('xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"')
    expect(xml).toContain('xmlns:imsss="http://www.imsglobal.org/xsd/imsss"')
  })

  it('uses the 2004 scormType casing on the SCO resource', () => {
    expect(xml).toContain('adlcp:scormType="sco" href="index.html"')
    expect(xml).not.toContain('scormtype=') // 1.2 spelling must not appear
  })

  it('carries the pass mark as an imsss primary objective, not masteryscore', () => {
    expect(xml).toContain('satisfiedByMeasure="true"')
    expect(xml).toContain('<imsss:minNormalizedMeasure>0.7</imsss:minNormalizedMeasure>')
    expect(xml).not.toContain('masteryscore')
  })

  it('escapes the title and lists every file', () => {
    expect(xml).toContain('Safety &amp; &quot;Compliance&quot; &lt;Course&gt;')
    expect(xml).toContain('<file href="index.html"/>')
    expect(xml).toContain('<file href="assets/p1_video.mp4"/>')
  })

  it('keeps imsss sequencing tags balanced', () => {
    for (const tag of ['imsss:sequencing', 'imsss:objectives', 'imsss:primaryObjective', 'imsss:minNormalizedMeasure']) {
      expect(xml.split(`<${tag}`).length - 1, `${tag} balance`).toBe(xml.split(`</${tag}>`).length - 1)
    }
  })
})

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })
})
