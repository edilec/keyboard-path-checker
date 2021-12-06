/**
 * Every untrusted string that reaches output is flattened, not only an excerpt
 * field.
 *
 * Four tools in this catalog stripped C0 and the line separators and let the C1
 * range through: U+0085 (NEL) and U+009B (8-bit CSI) forge lines in a human
 * report, U+202E reverses displayed text, and the isolates hide what they wrap.
 * One tool sanitised its evidence field carefully and let a page id containing a
 * newline forge whole lines.
 *
 * So each class below is tested through an IDENTIFIER -- a control ref and a
 * journey id, which become messages, evidence and the journeys array -- as well
 * as through a key name.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTROL_CLASSES, excerpt, hasForbiddenCharacter, isUsableText, renderable } from '../src/index.mjs'
import { capture, journeys, reportFor, runCli } from './support.mjs'

for (const [name, codePoints] of Object.entries(CONTROL_CLASSES)) {
  const dirty = codePoints.map((code) => String.fromCodePoint(code)).join('')

  test(`the ${name} class never reaches the report through a control ref`, async () => {
    const ref = `open${dirty}dialog`
    const { report } = await reportFor({
      'controls.json': capture({ controls: [{ ref, tabbable: false, activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: ref }] }]),
    })
    const serialized = JSON.stringify(report)
    for (const code of codePoints) {
      assert.ok(!serialized.includes(String.fromCodePoint(code)), `U+${code.toString(16).padStart(4, '0')} reached the report`)
    }
  })

  test(`the ${name} class never reaches the report through a journey id`, async () => {
    const { report } = await reportFor({
      'controls.json': capture({ controls: [{ ref: 'thing', tabbable: false, activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: `walk${dirty}through`, steps: [{ tabTo: 'thing' }] }]),
    })
    const serialized = JSON.stringify(report)
    for (const code of codePoints) {
      assert.ok(!serialized.includes(String.fromCodePoint(code)), `U+${code.toString(16).padStart(4, '0')} reached the report`)
    }
  })

  test(`the ${name} class never reaches the report through a key name`, async () => {
    const { report } = await reportFor({
      'controls.json': capture({ controls: [{ ref: 'thing', tabbable: true, activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: `Ent${dirty}er`, on: 'thing' }] }]),
    })
    const serialized = JSON.stringify(report)
    for (const code of codePoints) {
      assert.ok(!serialized.includes(String.fromCodePoint(code)), `U+${code.toString(16).padStart(4, '0')} reached the report`)
    }
  })
}

test('an unknown CLI option is flattened before it reaches stderr', async () => {
  const { code, stderr } = await runCli(['--root', '.', `--nope${String.fromCharCode(0x0a)}forged: line`])
  assert.equal(code, 2)
  assert.match(stderr.split('\n')[0], /Unknown option "--nope forged: line"/)
})

test('a value that cannot be rendered is described by its shape and never thrown over', () => {
  const hostile = JSON.parse('{"toString": {}}')
  assert.throws(() => String(hostile))
  assert.equal(renderable(hostile), '[object]')
  assert.equal(excerpt(hostile), '[object]')
})

test('isUsableText asks about the RENDERED form, not the raw one', () => {
  assert.equal(isUsableText('Enter'), true)
  assert.equal(isUsableText(String.fromCharCode(0x0001)), false, 'trim removes ECMAScript whitespace only')
  assert.equal(isUsableText(String.fromCharCode(0x200e)), false)
  assert.equal(isUsableText(String.fromCharCode(0x0085)), false)
  assert.equal(isUsableText(''), false)
  assert.equal(isUsableText(7), false)
})

test('hasForbiddenCharacter is not left holding a stale lastIndex between calls', () => {
  const dirty = `a${String.fromCharCode(0x0001)}b`
  assert.equal(hasForbiddenCharacter(dirty), true)
  assert.equal(hasForbiddenCharacter(dirty), true)
  assert.equal(hasForbiddenCharacter('clean'), false)
})

test('a control ref of stripped characters is refused rather than indexed as an empty ref', async () => {
  const { code, report } = await reportFor({
    'controls.json': `{ "schemaVersion": "1", "capture": { "activationObserved": true }, "controls": [{ "ref": "\\u200e\\u0001", "tabbable": true }] }`,
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'capture-invalid')
  assert.ok(finding !== undefined)
  assert.match(finding.message, /renders empty once control characters are removed/)
})
