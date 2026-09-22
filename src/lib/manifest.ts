import type { ScormVersion } from './types'

/**
 * imsmanifest.xml generation, SCORM 1.2 and SCORM 2004 (4th Edition).
 * The manifest MUST sit at the zip root — the packager enforces that; this
 * module only produces the XML string.
 *
 * Pass-mark plumbing differs by version:
 *   1.2  → <adlcp:masteryscore> on the item (0–100)
 *   2004 → imsss primary objective with satisfiedByMeasure and a
 *          minNormalizedMeasure of passMark/100 (the SCO also reports
 *          cmi.success_status itself, so this is belt and braces)
 */

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

export interface ManifestOptions {
  title: string
  passMark: number
  scormVersion: ScormVersion
  /** Paths of every file in the package besides imsmanifest.xml, zip-relative (e.g. "index.html", "assets/v.mp4"). */
  files: string[]
  /** Stable identifier suffix; defaults to a slug of the title so output is deterministic and testable. */
  identifier?: string
}

export function buildManifest(opts: ManifestOptions): string {
  const id = (opts.identifier ?? opts.title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()) || 'COURSE'
  const title = escapeXml(opts.title)
  const fileTags = opts.files.map((f) => `      <file href="${escapeXml(f)}"/>`).join('\n')

  if (opts.scormVersion === '2004') {
    // scaled measure, not a percentage — 70 → 0.7
    const measure = String(Math.round(opts.passMark) / 100)
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="ET_SCORM_${id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                      http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                      http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                      http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
                      http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>${title}</title>
      <item identifier="ITEM1" identifierref="RES1">
        <title>${title}</title>
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="PRIMARY" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${measure}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormType="sco" href="index.html">
${fileTags}
    </resource>
  </resources>
</manifest>
`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="ET_SCORM_${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>${title}</title>
      <item identifier="ITEM1" identifierref="RES1" isvisible="true">
        <title>${title}</title>
        <adlcp:masteryscore>${Math.round(opts.passMark)}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileTags}
    </resource>
  </resources>
</manifest>
`
}
