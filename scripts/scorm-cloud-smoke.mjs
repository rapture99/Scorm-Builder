/**
 * SCORM Cloud smoke check — "done" means the package imports and launches on
 * SCORM Cloud, not that it renders locally.
 *
 * Usage:
 *   set SCORMCLOUD_APP_ID=...       (from https://cloud.scorm.com → Apps/API)
 *   set SCORMCLOUD_SECRET=...
 *   node scripts/scorm-cloud-smoke.mjs path/to/Course_SCORM12.zip [courseId]
 *
 * The expected classification is inferred from the filename (*_SCORM2004.zip
 * → SCORM 2004, otherwise SCORM 1.2); override with EXPECT_STANDARD=regex.
 *
 * What it does:
 *   1. uploads the zip as an import job (POST /courses/importJobs/upload)
 *   2. polls the job until COMPLETE or ERROR
 *   3. prints the parsed course structure SCORM Cloud saw
 *   4. deletes the course again unless KEEP_COURSE=1
 *
 * Exit code 0 = imported cleanly; 1 = anything else.
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const BASE = 'https://cloud.scorm.com/api/v2'
const appId = process.env.SCORMCLOUD_APP_ID
const secret = process.env.SCORMCLOUD_SECRET
const zipPath = process.argv[2]
const courseId = process.argv[3] ?? `smoke_${basename(zipPath ?? 'x').replace(/\W+/g, '_')}_${Date.now()}`

if (!appId || !secret || !zipPath) {
  console.error('Usage: SCORMCLOUD_APP_ID=… SCORMCLOUD_SECRET=… node scripts/scorm-cloud-smoke.mjs <package.zip> [courseId]')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64')

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: auth, ...headers }, body })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`)
  return json
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  console.log(`Uploading ${zipPath} as course "${courseId}"…`)
  const zip = await readFile(zipPath)
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), basename(zipPath))
  const { result: jobId } = await api(
    'POST',
    `/courses/importJobs/upload?courseId=${encodeURIComponent(courseId)}&mayCreateNewVersion=false`,
    form,
  )
  console.log(`Import job ${jobId} — polling…`)

  let job
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    job = await api('GET', `/courses/importJobs/${encodeURIComponent(jobId)}`)
    process.stdout.write(`  status: ${job.status}\r\n`)
    if (job.status !== 'RUNNING') break
  }

  if (job.status !== 'COMPLETE') {
    console.error('\nIMPORT FAILED')
    console.error(JSON.stringify(job, null, 2))
    process.exit(1)
  }

  // SCORM Cloud reports e.g. SCORM_12 or SCORM_2004_4TH_EDITION
  const expected = process.env.EXPECT_STANDARD
    ? new RegExp(process.env.EXPECT_STANDARD)
    : /SCORM2004/i.test(basename(zipPath)) ? /^SCORM_2004/ : /^SCORM_12$/

  const course = await api('GET', `/courses/${encodeURIComponent(courseId)}?includeCourseMetadata=true`)
  console.log('\nIMPORT OK')
  console.log(`  title:        ${course.title}`)
  console.log(`  courseId:     ${course.id}`)
  console.log(`  version:      ${course.version}`)
  console.log(`  learningType: ${course.courseLearningStandard ?? 'unknown'} (expect ${expected})`)
  if (course.courseLearningStandard && !expected.test(course.courseLearningStandard)) {
    console.error(`  ✗ SCORM Cloud classification does not match ${expected}`)
    process.exit(1)
  }

  if (process.env.KEEP_COURSE === '1') {
    console.log(`\nKept course ${courseId} — preview it at https://cloud.scorm.com`)
  } else {
    await api('DELETE', `/courses/${encodeURIComponent(courseId)}`)
    console.log(`\nCleaned up course ${courseId}. Smoke check PASSED ✓`)
  }
} catch (err) {
  console.error(`\nSmoke check FAILED: ${err.message}`)
  process.exit(1)
}
