/**
 * Input confinement: the REAL path, not the lexical one.
 *
 * Rejecting `../` and absolute paths is not confinement. A symbolic link
 * planted inside the declared root was followed out of the tree in a sibling
 * tool, and out-of-root content was echoed into the report. So the resolved
 * real path is compared against the resolved real root.
 */

import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, makeRoot, removeRoot, runCli } from './support.mjs'

test('a symbolic link inside the root that points outside it is refused', async () => {
  const outside = await makeRoot({
    'secret.json': capture({ controls: [{ ref: 'leaked-control', tabbable: true, activatedBy: ['Enter'] }] }),
  })
  const root = await makeRoot({ 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'leaked-control' }] }]) })
  try {
    await symlink(join(outside, 'secret.json'), join(root, 'controls.json'))
    const { code, stdout } = await runCli(['--root', root, '--json'])
    assert.equal(code, 2)
    const report = JSON.parse(stdout)
    const finding = report.findings.find((entry) => entry.ruleId === 'path-escapes-root')
    assert.ok(finding !== undefined, JSON.stringify(report.findings))
    assert.match(finding.message, /A symbolic link inside the root is still a way out of it/)
    assert.equal(report.summary.controls, 0, 'out-of-root controls reached the index')
  } finally {
    await removeRoot(root)
    await removeRoot(outside)
  }
})

test('a "../" path and an absolute path are both refused', async () => {
  const root = await makeRoot({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
  })
  try {
    for (const name of ['../elsewhere.json', '/etc/hosts']) {
      const { code, stdout } = await runCli(['--root', root, '--json', '--capture', name])
      assert.equal(code, 2, name)
      assert.ok(JSON.parse(stdout).findings.some((entry) => entry.ruleId === 'path-escapes-root'), name)
    }
  } finally {
    await removeRoot(root)
  }
})

test('a symbolic link inside the root that stays inside it is followed', async () => {
  const root = await makeRoot({
    'real/page.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
  })
  try {
    await symlink(join(root, 'real', 'page.json'), join(root, 'controls.json'))
    const { code, stdout } = await runCli(['--root', root, '--json'])
    assert.equal(code, 0)
    assert.equal(JSON.parse(stdout).summary.controls, 4)
  } finally {
    await removeRoot(root)
  }
})

test('no host path ever reaches the report', async () => {
  const root = await makeRoot({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }] }]),
  })
  try {
    const { stdout, stderr } = await runCli(['--root', root])
    assert.ok(!stdout.includes(root))
    assert.ok(!stderr.includes(root))
    for (const finding of JSON.parse(stdout).findings) {
      assert.ok(['controls.json', 'journeys.json'].includes(finding.location.file), finding.location.file)
    }
  } finally {
    await removeRoot(root)
  }
})

test('a directory named as a document is reported as unreadable, not as an empty capture', async () => {
  const root = await makeRoot({
    'controls.json/keep.txt': 'x',
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
  })
  try {
    const { code, stdout } = await runCli(['--root', root, '--json'])
    assert.equal(code, 2)
    const report = JSON.parse(stdout)
    assert.ok(report.findings.some((entry) => entry.ruleId === 'input-unreadable'))
    assert.ok(!report.findings.some((entry) => entry.ruleId === 'no-controls-declared'), 'an unreadable capture was read as an empty one')
  } finally {
    await removeRoot(root)
  }
})
