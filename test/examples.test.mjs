/**
 * The examples in the README run, and they run at the exit codes the README
 * says they do. An example that has drifted is a documentation overclaim.
 *
 * The last test is the point of the trio: `unobserved` is `pointer-only` with
 * one boolean changed, and it must not produce the failure `pointer-only` does.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { PACKAGE_ROOT, runCli } from './support.mjs'

test('examples/restores-focus passes, and both journeys end on the control that opened the dialog', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/restores-focus', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 0)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'pass')
  assert.deepEqual(report.findings, [])
  assert.deepEqual(report.journeys.map((entry) => entry.endsFocusedOn), ['delete-order', 'delete-order'])
})

test('examples/pointer-only fails on both acceptance criteria', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/pointer-only', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 1)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'fail')
  const rules = report.findings.map((finding) => finding.ruleId)
  assert.ok(rules.includes('pointer-only-activation'))
  assert.ok(rules.includes('focus-not-restored'))
})

test('examples/unobserved is incomplete with zero errors, which is the whole point of it', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/unobserved', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 2)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.summary.errors, 0)
  assert.ok(report.summary.notEvaluated.includes('activation-undetermined'))
  assert.ok(!report.findings.some((finding) => finding.ruleId === 'pointer-only-activation'))
})

test('unobserved and pointer-only differ by exactly one field, so the different verdict comes from the evidence', async () => {
  const read = async (directory, name) => JSON.parse(await readFile(join(PACKAGE_ROOT, 'examples', directory, name), 'utf8'))
  const strict = await read('pointer-only', 'controls.json')
  const loose = await read('unobserved', 'controls.json')
  assert.deepEqual(loose.controls, strict.controls)
  assert.deepEqual(loose.regions, strict.regions)
  assert.equal(strict.capture.activationObserved, true)
  assert.equal(loose.capture.activationObserved, false)
  assert.deepEqual(
    await read('unobserved', 'journeys.json'),
    await read('pointer-only', 'journeys.json'),
  )
})
