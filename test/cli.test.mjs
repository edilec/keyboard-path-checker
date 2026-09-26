/**
 * The CLI surface, and the two shapes of exit 2.
 *
 * A configuration error means the run never had a subject, so stdout is EMPTY.
 * A document that could not be read means the run had a subject and failed to
 * get evidence about it, so stdout carries an `incomplete` report. Both are
 * exit 2, and a consumer that pipes stdout has to handle the empty case -- which
 * is documented rather than papered over with a fabricated report.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPEN_AND_ESCAPE, capture, dialogControls, dialogRegion, journeys, makeRoot, removeRoot, runCli,
} from './support.mjs'

const FILES = {
  'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
  'journeys.json': journeys(OPEN_AND_ESCAPE),
}

test('--help explains itself on stdout and exits 0', async () => {
  const { code, stdout } = await runCli(['--help'])
  assert.equal(code, 0)
  assert.match(stdout, /NO BROWSER IS OPENED AND NO KEY IS PRESSED/)
  assert.match(stdout, /Exit codes:/)
  assert.match(stdout, /capture\.activationObserved/)
})

test('the help text states every limit the tool enforces', async () => {
  const { stdout } = await runCli(['--help'])
  for (const flag of ['--max-controls', '--max-document-bytes', '--max-findings', '--max-journeys', '--max-runtime-ms', '--max-steps-per-journey']) {
    assert.match(stdout, new RegExp(flag.replace(/-/g, '\\-')))
  }
})

test('the help text says this tool writes nothing, because it writes nothing', async () => {
  const { stdout } = await runCli(['--help'])
  assert.match(stdout, /This tool writes nothing/)
  assert.ok(!stdout.includes('--out '), 'the help offers an --out this tool does not have')
})

test('--version prints a version and nothing else', async () => {
  const { code, stdout } = await runCli(['--version'])
  assert.equal(code, 0)
  assert.match(stdout, /^\d+\.\d+\.\d+\n$/)
})

const CONFIGURATION_ERRORS = [
  { why: 'an unknown option', args: ['--root', '.', '--nope'] },
  { why: 'a missing --root', args: ['--capture', 'a.json'] },
  { why: 'a repeated flag', args: ['--root', '.', '--root', '.'] },
  { why: 'a repeated limit', args: ['--root', '.', '--max-journeys', '5', '--max-journeys', '6'] },
  { why: 'a flag with no value', args: ['--root'] },
  // A value that is itself a flag: without the leading-dash check the flag
  // swallows the next one, the run reads a document named "--json" and the
  // configuration error turns into a report on stdout -- the other exit-2 shape.
  { why: 'a value flag followed by another flag', args: ['--root', '.', '--capture', '--json'] },
  { why: 'a limit that is not a positive integer', args: ['--root', '.', '--max-journeys', 'many'] },
  { why: 'a limit of zero', args: ['--root', '.', '--max-journeys', '0'] },
  { why: 'a limit past its cap', args: ['--root', '.', '--max-journeys', '9999999999'] },
  // Number() accepts these and the documented form does not. Without the
  // digits-only check the limit is silently set to 16 and 1000.
  { why: 'a limit written in a form only Number() accepts', args: ['--root', '.', '--max-journeys', '0x10'] },
  { why: 'a limit written in exponent form', args: ['--root', '.', '--max-journeys', '1e3'] },
  { why: 'a root that is not there', args: ['--root', '/no/such/directory/anywhere'] },
]

for (const { why, args } of CONFIGURATION_ERRORS) {
  test(`${why} is a configuration error: exit 2 with empty stdout`, async () => {
    const { code, stdout, stderr } = await runCli(args)
    assert.equal(code, 2, why)
    assert.equal(stdout, '', why)
    assert.ok(stderr.length > 0, why)
  })
}

test('a document that could not be read is exit 2 WITH a report, so a consumer learns which one', async () => {
  const root = await makeRoot({ 'journeys.json': journeys(OPEN_AND_ESCAPE) })
  try {
    const { code, stdout } = await runCli(['--root', root, '--json'])
    assert.equal(code, 2)
    const report = JSON.parse(stdout)
    assert.equal(report.status, 'incomplete')
    assert.equal(report.findings.find((entry) => entry.ruleId === 'input-unreadable').location.file, 'controls.json')
  } finally {
    await removeRoot(root)
  }
})

test('--json suppresses the human summary and leaves stdout untouched', async () => {
  const root = await makeRoot(FILES)
  try {
    const plain = await runCli(['--root', root])
    const quiet = await runCli(['--root', root, '--json'])
    assert.equal(plain.stdout, quiet.stdout)
    assert.ok(plain.stderr.length > 0)
    assert.equal(quiet.stderr, '')
  } finally {
    await removeRoot(root)
  }
})

test('an incomplete run says on stderr that it is not a pass', async () => {
  const root = await makeRoot({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), activationObserved: false }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  try {
    const { code, stderr } = await runCli(['--root', root])
    assert.equal(code, 2)
    assert.match(stderr, /incomplete: this run is not a pass/)
  } finally {
    await removeRoot(root)
  }
})

test('--capture and --journeys choose the documents, and the report names them relatively', async () => {
  const root = await makeRoot({
    'captures/page.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'plans/walk.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }] }]),
  })
  try {
    const { code, stdout } = await runCli(['--root', root, '--json', '--capture', 'captures/page.json', '--journeys', 'plans/walk.json'])
    assert.equal(code, 2)
    const report = JSON.parse(stdout)
    assert.equal(report.findings[0].location.file, 'plans/walk.json')
    assert.ok(!JSON.stringify(report).includes(root), 'a host path reached the report')
  } finally {
    await removeRoot(root)
  }
})

test('this tool writes nothing: no file in the root changes across a run', async () => {
  const root = await makeRoot(FILES)
  try {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const before = await readdir(root)
    const contents = await Promise.all(before.map((name) => readFile(join(root, name), 'utf8')))
    await runCli(['--root', root, '--json'])
    assert.deepEqual((await readdir(root)).sort(), before.sort())
    assert.deepEqual(await Promise.all(before.map((name) => readFile(join(root, name), 'utf8'))), contents)
  } finally {
    await removeRoot(root)
  }
})
