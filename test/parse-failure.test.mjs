/**
 * The parse-failure helper: ordering is the whole guard.
 *
 * V8 reports a JSON parse failure two ways and one of them quotes the input
 * back. A helper that looks for `at position \d+` FIRST finds that text inside
 * the quoted span whenever the document itself contains it, and slices the
 * document straight back out. Nineteen of thirty-eight tools in this catalog
 * shipped exactly that bug; every group that wrote this test found it.
 *
 * The last test is the backstop, and it is why the helper is safe against
 * wordings V8 has not invented yet: a surviving double quote means a snippet
 * survived, whatever the branches above concluded.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFailureDetail } from '../src/index.mjs'
import { capture, dialogControls, dialogRegion, reportFor } from './support.mjs'

function detailFor(document) {
  try {
    JSON.parse(document)
  } catch (error) {
    return { message: error.message, detail: parseFailureDetail(error) }
  }
  throw new Error('that document parsed, so this test cannot fail')
}

test('a document whose own text reads "at position 1" is not sliced back out', () => {
  const { message, detail } = detailFor('at position 1')
  assert.match(message, /"at position 1"/)
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.ok(!detail.includes('at position 1'))
})

test('a document that is only a credential is not reproduced', () => {
  const { message, detail } = detailFor('AKIAIOSFODNN7EXAMPLE')
  assert.match(message, /AKIAIOSFODNN7EXAMPLE/)
  assert.ok(!detail.includes('AKIAIOSFODNN7EXAMPLE'))
  assert.equal(detail, "unexpected token 'A' at the start of the document")
})

test('a long document with a sensitive prefix is not reproduced, and truncation would not have helped', () => {
  const { message, detail } = detailFor(`password=hunter2 ${'x'.repeat(400)}`)
  assert.match(message, /password=h/)
  assert.ok(!detail.includes('password'))
  assert.equal(detail, "unexpected token 'p' at the start of the document")
})

test('a quoted span containing a newline is still recognised as a quoted span', () => {
  const { message, detail } = detailFor('{"alpha":\n  ZQXJVBMP7W}')
  assert.match(message, /ZQXJVBMP7W/)
  assert.ok(message.includes('\n'), 'this message must contain a newline, or the dotAll flag is not under test')
  assert.ok(!detail.includes('ZQXJVBMP7W'))
  assert.ok(!detail.includes('alpha'))
  assert.equal(detail, "unexpected token 'Z' inside the document")
})

test('the safe positional form still yields the position, because an offset says nothing about content', () => {
  const { message, detail } = detailFor('{"a": 1 "b": 2}')
  assert.ok(!message.includes('"'.repeat(1) + 'a'), 'the positional form quotes JSON punctuation with apostrophes')
  assert.match(detail, /at position 8/)
  assert.equal(detail, "Expected ',' or '}' after property value in JSON at position 8 (line 1 column 9)")
})

test('no detail this helper produces carries a double quote', () => {
  const documents = [
    'at position 1',
    'AKIAIOSFODNN7EXAMPLE',
    `password=hunter2 ${'x'.repeat(400)}`,
    '{"alpha":\n  ZQXJVBMP7W}',
    '{"a": 1 "b": 2}',
    '',
    '{',
    '[1,',
    '"unterminated',
    '{"a": 1} trailing',
  ]
  for (const document of documents) {
    try {
      JSON.parse(document)
    } catch (error) {
      assert.ok(!parseFailureDetail(error).includes('"'), `a quoted snippet survived for ${JSON.stringify(document.slice(0, 20))}`)
    }
  }
})

test('an unrecognised wording falls back to the generic sentence rather than guessing', () => {
  assert.equal(parseFailureDetail(new Error('Something new from V8 mentioning "a snippet"')), 'the document could not be parsed as JSON')
  assert.equal(parseFailureDetail(new Error('Unexpected end of JSON input')), 'Unexpected end of JSON input')
  assert.equal(parseFailureDetail(undefined), 'the document could not be parsed as JSON')
})

test('the CLI reports a parse failure without reproducing the document', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': 'AKIAIOSFODNN7EXAMPLE',
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'input-not-json')
  assert.ok(finding !== undefined)
  assert.ok(!JSON.stringify(report).includes('AKIAIOSFODNN7EXAMPLE'))
  assert.match(finding.message, /not valid JSON/)
})
