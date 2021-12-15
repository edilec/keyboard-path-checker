/**
 * keyboard-path-checker -- run declared keyboard journeys against a declared
 * capture of a local fixture's controls, and report where reachability,
 * activation, dismissal or focus return does not hold.
 *
 * TWO DOCUMENTS GO IN AND NOTHING ELSE HAPPENS. The first is a capture:
 * somebody walked a fixture with a keyboard, or exported the same facts from a
 * harness, and wrote down each control -- whether Tab reaches it, which keys
 * activate it, which region it opens or dismisses -- and each region -- whether
 * it is modal, which keys close it, where focus goes when it opens, and where
 * focus returns when it closes. The second is a set of journeys: the keyboard
 * paths a task is meant to be doable by.
 *
 * NO BROWSER IS OPENED AND NO KEY IS PRESSED. This tool does not drive a page,
 * does not press Tab or Enter or Escape, does not observe focus and does not
 * emulate a screen reader. It runs a state machine over two JSON documents.
 * Every sentence in the report is a sentence about those documents, and the
 * report says so: `summary.evidence` is `"declared-capture"`, `keysPressed` is
 * 0, and `browserDriven` and `screenReaderEmulated` are `false` in every report
 * this tool can produce.
 *
 * The distinction the whole tool turns on:
 *
 * - The capture SAYS what happens, and the journey either matches it or does
 *   not. That is a pass or a fail.
 * - The capture does NOT say. Focus becomes undetermined, the region stack
 *   becomes undetermined with it, and neither is ever compared against an
 *   expectation -- not as a match and not as a mismatch. The run is
 *   `incomplete`, which exits 2 and is never a pass.
 *
 * The second case is why `capture.activationObserved` exists. A capture that
 * did not actually try each key has an `activatedBy` list of what somebody
 * happened to press, not of what works -- so a key missing from it cannot
 * falsify anything, and this tool refuses to say it does.
 */

import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'

import { STEP_KINDS, runJourney } from './journey.mjs'
import {
  byCodeUnit, decodeUtf8, escapePointerSegment, excerpt, isPlainObject, isUsableText,
  parseFailureDetail, shapeOf,
} from './text.mjs'

export { STEP_KINDS, runJourney } from './journey.mjs'
export {
  CONTROL_CLASSES, EXCERPT_LIMIT, byCodeUnit, decodeUtf8, escapePointerSegment, excerpt,
  hasForbiddenCharacter, isPlainObject, isUsableText, parseFailureDetail, renderable, shapeOf,
} from './text.mjs'

export const TOOL_ID = 'keyboard-path-checker'
export const REPORT_SCHEMA_VERSION = '1'
export const SUPPORTED_DOCUMENT_VERSION = '1'
export const DEFAULT_CAPTURE_NAME = 'controls.json'
export const DEFAULT_JOURNEYS_NAME = 'journeys.json'

/**
 * Bounds. Reaching one is an `incomplete` run with a finding naming the limit --
 * never a silent truncation, and never a pass over the part that was reached.
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxControls: 2000,
  maxDocumentBytes: 1048576,
  maxFindings: 1000,
  maxJourneys: 200,
  maxRuntimeMs: 10000,
  maxStepsPerJourney: 200,
})

/** A caller may lower a limit, never raise it past these caps. */
export const HARD_LIMITS = Object.freeze({
  maxControls: 200000,
  maxDocumentBytes: 67108864,
  maxFindings: 20000,
  maxJourneys: 20000,
  maxRuntimeMs: 600000,
  maxStepsPerJourney: 20000,
})

/**
 * The authoritative rule severity table.
 *
 * Severity decides whether a run fails, so it lives in one place and every
 * finding takes its value from here; an unknown rule id throws rather than
 * defaulting. `test/rule-catalog.test.mjs` checks this against
 * docs/journey-rules.md in both directions, which is a consistency check and
 * NOT the defence -- a table, a document and a test's expected map are three
 * declarations one coordinated edit satisfies.
 * `test/severity-outcomes.test.mjs` is the defence: it drives real documents
 * through the real CLI and asserts the exit code.
 */
export const RULE_SEVERITY = Object.freeze({
  'activation-undetermined': 'warning',
  'capture-invalid': 'error',
  'capture-not-declared': 'warning',
  'control-duplicate-ref': 'error',
  'control-not-reachable': 'error',
  'control-undeclared': 'error',
  'dismiss-keys-not-declared': 'warning',
  'dismiss-wrong-region': 'error',
  'focus-mismatch': 'error',
  'focus-not-restored': 'error',
  'focus-return-not-declared': 'warning',
  'focus-undetermined': 'warning',
  'input-not-json': 'error',
  'input-not-utf8': 'error',
  'input-too-large': 'error',
  'input-unreadable': 'error',
  'journey-duplicate-id': 'error',
  'journey-invalid': 'error',
  'journey-without-steps': 'error',
  'journeys-empty': 'error',
  'key-does-not-dismiss': 'error',
  'key-not-activating': 'error',
  'no-controls-declared': 'error',
  'nothing-checked': 'error',
  'path-escapes-root': 'error',
  'pointer-only-activation': 'error',
  'region-duplicate-ref': 'error',
  'region-left-open': 'error',
  'region-undeclared': 'error',
  'region-without-initial-focus': 'warning',
  'schema-version-unsupported': 'error',
  'step-without-effect': 'error',
  'tabbable-undetermined': 'warning',
  'time-budget-exceeded': 'error',
  'too-many-controls': 'error',
  'too-many-findings': 'error',
  'too-many-journeys': 'error',
  'too-many-steps': 'error',
  'unknown-field': 'error',
  'unreachable-behind-modal': 'error',
})

/**
 * The rules that mean "this run did not obtain the evidence", as opposed to
 * "this run obtained the evidence and it is bad news".
 *
 * Every one is raised through `addUnknown`, which is the single place
 * `incomplete` is set, and every one appears in `summary.notEvaluated`.
 */
export const LIMITATION_RULES = Object.freeze([
  'activation-undetermined',
  'capture-invalid',
  'capture-not-declared',
  'control-duplicate-ref',
  'control-undeclared',
  'dismiss-keys-not-declared',
  'focus-return-not-declared',
  'focus-undetermined',
  'input-not-json',
  'input-not-utf8',
  'input-too-large',
  'input-unreadable',
  'journey-invalid',
  'path-escapes-root',
  'region-duplicate-ref',
  'region-undeclared',
  'region-without-initial-focus',
  'schema-version-unsupported',
  'tabbable-undetermined',
  'time-budget-exceeded',
  'too-many-controls',
  'too-many-findings',
  'too-many-journeys',
  'too-many-steps',
  'unknown-field',
])

const MESSAGE_LIMIT = 400
const SUGGESTION_LIMIT = 300
const EVIDENCE_LIMIT = 240
const LOCATION_LIMIT = 200
const REF_LIMIT = 120

const ALLOWED_OPTIONS = Object.freeze(['capture', 'journeys', 'limits', 'monotonic', 'root'])
const ALLOWED_CAPTURE_FIELDS = Object.freeze(['capture', 'controls', 'regions', 'schemaVersion'])
const ALLOWED_CAPTURE_META_FIELDS = Object.freeze(['activationObserved', 'method'])
const ALLOWED_CONTROL_FIELDS = Object.freeze(['activatedBy', 'dismisses', 'name', 'opens', 'ref', 'region', 'role', 'tabbable'])
const ALLOWED_REGION_FIELDS = Object.freeze(['dismissKeys', 'initialFocus', 'modal', 'ref', 'restoresFocusTo', 'role'])
const ALLOWED_JOURNEYS_FIELDS = Object.freeze(['journeys', 'schemaVersion'])
const ALLOWED_JOURNEY_FIELDS = Object.freeze(['description', 'id', 'steps'])
const ALLOWED_STEP_FIELDS = Object.freeze(['expectFocus', 'on', 'press', 'tabTo'])

export function validateLimits(overrides = {}) {
  if (!isPlainObject(overrides)) throw new TypeError('limits must be an object')
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(overrides).sort(byCodeUnit)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) {
      throw new TypeError(
        `Unknown limit "${excerpt(key, 60)}"; known limits are ${Object.keys(DEFAULT_LIMITS).sort(byCodeUnit).join(', ')}`,
      )
    }
    const value = overrides[key]
    const cap = HARD_LIMITS[key]
    if (!Number.isInteger(value) || value < 1 || value > cap) {
      throw new TypeError(`limits.${key} must be an integer between 1 and ${cap}`)
    }
    limits[key] = value
  }
  return Object.freeze(limits)
}

function buildFinding({ ruleId, file, pointer = '', message, evidence, suggestion }) {
  const severity = RULE_SEVERITY[ruleId]
  if (severity === undefined) throw new Error(`No severity is declared for rule "${ruleId}"`)
  const finding = {
    ruleId,
    severity,
    message: excerpt(message, MESSAGE_LIMIT),
    location: { file: excerpt(file, LOCATION_LIMIT), pointer: excerpt(pointer, LOCATION_LIMIT) },
  }
  if (evidence !== undefined) finding.evidence = excerpt(evidence, EVIDENCE_LIMIT)
  if (suggestion !== undefined) finding.suggestion = excerpt(suggestion, SUGGESTION_LIMIT)
  return finding
}

/** The run's accumulator. `incomplete` is set in exactly one place. */
function createRun(limits) {
  return {
    limits,
    findings: [],
    incomplete: false,
    limitationsSeen: new Set(),
    capped: false,
    add(entry) {
      if (this.findings.length >= this.limits.maxFindings) {
        if (!this.capped) {
          this.capped = true
          this.incomplete = true
          this.limitationsSeen.add('too-many-findings')
          this.findings.push(buildFinding({
            ruleId: 'too-many-findings',
            file: entry.file,
            message: `This run produced more than the maxFindings limit of ${this.limits.maxFindings} findings, so the rest were dropped. What was dropped is not known to be clean.`,
            suggestion: 'Raise --max-findings, or fix the findings already reported and run again.',
          }))
        }
        return
      }
      this.findings.push(buildFinding(entry))
    },
    /**
     * Evidence the run wanted and did not get.
     *
     * This is the ONLY place `incomplete` is set, so there is one path to audit
     * rather than thirty. Every caller that cannot see something calls this,
     * and no caller sets the flag directly.
     */
    addUnknown(entry) {
      this.incomplete = true
      this.limitationsSeen.add(entry.ruleId)
      this.add(entry)
    },
  }
}

/**
 * Sort by `(location.file, location.pointer, ruleId, message)`.
 *
 * Every key is compared by UTF-16 code unit. No collator: ICU data differs
 * between Node builds, so a collated order makes two correct machines disagree
 * about the same report. One visible consequence is documented rather than
 * hidden: `/steps/10` sorts before `/steps/2`, because that is what comparing
 * code units does.
 */
function sortFindings(findings) {
  return [...findings].sort((left, right) => (
    byCodeUnit(left.location.file, right.location.file)
    || byCodeUnit(left.location.pointer, right.location.pointer)
    || byCodeUnit(left.ruleId, right.ruleId)
    || byCodeUnit(left.message, right.message)
  ))
}

/** Resolve a name under the real root, refusing anything that leaves it. */
async function resolveInput(realRoot, name) {
  if (typeof name !== 'string' || name.length === 0) return { ok: false, reason: 'escapes' }
  if (isAbsolute(name)) return { ok: false, reason: 'escapes' }
  const normalized = normalize(name)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) return { ok: false, reason: 'escapes' }
  try {
    // The REAL path, not the lexical one. A symbolic link planted inside the
    // root is still a way out of the root, and a lexical prefix check says it
    // is not.
    const real = await realpath(resolve(realRoot, normalized))
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, reason: 'escapes' }
    return { ok: true, real }
  } catch (error) {
    return { ok: false, reason: 'unreadable', code: error.code }
  }
}

/** Read one JSON document, recording every way it could fail to arrive. */
async function readDocument(run, realRoot, name, file, limits) {
  const located = await resolveInput(realRoot, name)
  if (!located.ok) {
    run.addUnknown(located.reason === 'escapes'
      ? {
        file,
        ruleId: 'path-escapes-root',
        message: 'This document resolves outside the declared root, so it was not read. A symbolic link inside the root is still a way out of it.',
        suggestion: 'Point --root at the directory that really holds the document.',
      }
      : {
        file,
        ruleId: 'input-unreadable',
        message: `This document could not be read (${excerpt(located.code ?? 'unreadable', 40)}).`,
        suggestion: 'Check the path and the file permissions.',
      })
    return undefined
  }

  let bytes
  try {
    bytes = await readFile(located.real)
  } catch (error) {
    run.addUnknown({
      file,
      ruleId: 'input-unreadable',
      message: `This document could not be read (${excerpt(error.code ?? 'unreadable', 40)}).`,
      suggestion: 'Check the path and the file permissions.',
    })
    return undefined
  }

  if (bytes.byteLength > limits.maxDocumentBytes) {
    run.addUnknown({
      file,
      ruleId: 'input-too-large',
      message: `This document is ${bytes.byteLength} bytes, past the maxDocumentBytes limit of ${limits.maxDocumentBytes}. It was not parsed, so nothing is claimed about what it contains.`,
      suggestion: 'Raise --max-document-bytes, or split the capture.',
    })
    return undefined
  }

  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) {
    run.addUnknown({
      file,
      ruleId: 'input-not-utf8',
      message: 'This document is not valid UTF-8, so it was not parsed. The decoder decides that, not a search of the decoded text for a replacement character.',
      suggestion: 'Re-encode the document as UTF-8.',
    })
    return undefined
  }

  try {
    return JSON.parse(decoded.text)
  } catch (error) {
    run.addUnknown({
      file,
      ruleId: 'input-not-json',
      // The detail says where the parse failed and never reproduces the
      // document: V8's own message quotes the input back, so the raw message
      // may never reach a stream.
      message: `This document is not valid JSON (${excerpt(parseFailureDetail(error), 200)}), so it was not interpreted.`,
      suggestion: 'Correct the JSON.',
    })
    return undefined
  }
}

function checkEnvelope(run, document, file, allowedFields, invalidRule) {
  if (!isPlainObject(document)) {
    run.addUnknown({
      file,
      ruleId: invalidRule,
      message: `This document is ${shapeOf(document)}, not an object, so it was not interpreted.`,
      suggestion: 'See docs/journey-rules.md for the document shape.',
    })
    return false
  }
  if (document.schemaVersion !== SUPPORTED_DOCUMENT_VERSION) {
    run.addUnknown({
      file,
      ruleId: 'schema-version-unsupported',
      pointer: '/schemaVersion',
      message: `This document declares schemaVersion ${typeof document.schemaVersion === 'string' ? `"${excerpt(document.schemaVersion, 40)}"` : shapeOf(document.schemaVersion)}; this tool reads version "${SUPPORTED_DOCUMENT_VERSION}". It was not interpreted.`,
      suggestion: `Set schemaVersion to "${SUPPORTED_DOCUMENT_VERSION}".`,
    })
    return false
  }
  for (const key of Object.keys(document).sort(byCodeUnit)) {
    if (allowedFields.includes(key)) continue
    run.addUnknown({
      file,
      ruleId: 'unknown-field',
      pointer: `/${escapePointerSegment(key)}`,
      message: `"${excerpt(key, 60)}" is not a field this tool reads. A one-character typo in a field name would silently switch a check off, so an unknown field is refused rather than ignored.`,
      suggestion: `Known fields are ${allowedFields.join(', ')}.`,
    })
  }
  return true
}

function unknownFields(run, object, allowed, file, pointer) {
  for (const key of Object.keys(object).sort(byCodeUnit)) {
    if (allowed.includes(key)) continue
    run.addUnknown({
      file,
      ruleId: 'unknown-field',
      pointer: `${pointer}/${escapePointerSegment(key)}`,
      message: `"${excerpt(key, 60)}" is not a field this tool reads here. An unknown field is refused rather than ignored, because a typo would switch a check off silently.`,
      suggestion: `Known fields are ${allowed.join(', ')}.`,
    })
  }
}

function optionalRef(run, value, file, pointer, what) {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!isUsableText(value, REF_LIMIT)) {
    run.addUnknown({
      file,
      ruleId: 'capture-invalid',
      pointer,
      message: `${what} is ${shapeOf(value)}, not a usable ref, so this entry was not used.`,
      suggestion: 'Give the ref of a control or region declared in this capture.',
    })
    return { ok: false }
  }
  return { ok: true, value }
}

function optionalTokens(run, value, file, pointer, what) {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!Array.isArray(value)) {
    run.addUnknown({
      file,
      ruleId: 'capture-invalid',
      pointer,
      message: `${what} is ${shapeOf(value)}, not an array, so this entry was not used.`,
      suggestion: 'Write it as an array of key names.',
    })
    return { ok: false }
  }
  const tokens = []
  for (let index = 0; index < value.length; index += 1) {
    if (isUsableText(value[index], 40)) { tokens.push(value[index]); continue }
    run.addUnknown({
      file,
      ruleId: 'capture-invalid',
      pointer: `${pointer}/${index}`,
      message: `This entry of ${what} is ${shapeOf(value[index])}, not a usable key name, so the whole list was not used. A list this tool read only part of is not a list of what works.`,
      suggestion: 'Write each entry as a key name, such as Enter, Space, Escape or pointer.',
    })
    return { ok: false }
  }
  return { ok: true, value: tokens }
}

/** Read the capture document into the index the journeys are run against. */
function readCapture(run, document, file, limits) {
  if (!checkEnvelope(run, document, file, ALLOWED_CAPTURE_FIELDS, 'capture-invalid')) return null

  let activationObserved = false
  const meta = document.capture
  if (meta === undefined) {
    run.addUnknown({
      file,
      ruleId: 'capture-not-declared',
      message: 'This document declares no "capture" block, so whether anybody actually tried each key is not stated. Every activation this run would otherwise have judged is undetermined instead.',
      suggestion: 'Add { "capture": { "method": "...", "activationObserved": true } } once each declared key has really been tried.',
    })
  } else if (!isPlainObject(meta)) {
    run.addUnknown({
      file,
      ruleId: 'capture-invalid',
      pointer: '/capture',
      message: `"capture" is ${shapeOf(meta)}, not an object, so whether activation was observed is not stated.`,
      suggestion: 'Write capture as { "method": "...", "activationObserved": true }.',
    })
  } else {
    unknownFields(run, meta, ALLOWED_CAPTURE_META_FIELDS, file, '/capture')
    if (typeof meta.activationObserved === 'boolean') activationObserved = meta.activationObserved
    else {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer: '/capture/activationObserved',
        message: `"activationObserved" is ${shapeOf(meta.activationObserved)}, not a boolean, so this run does not know whether the declared keys were really tried. Every activation is undetermined instead.`,
        suggestion: 'Set activationObserved to true only once each declared key has really been tried.',
      })
    }
  }

  const rawControls = document.controls
  if (!Array.isArray(rawControls)) {
    run.addUnknown({
      file,
      ruleId: 'capture-invalid',
      pointer: '/controls',
      message: `"controls" is ${shapeOf(rawControls)}, not an array, so no control was read.`,
      suggestion: 'Write controls as an array of { "ref": "...", "tabbable": true } entries.',
    })
    return null
  }
  if (rawControls.length > limits.maxControls) {
    run.addUnknown({
      file,
      ruleId: 'too-many-controls',
      pointer: '/controls',
      message: `This capture holds ${rawControls.length} controls, past the maxControls limit of ${limits.maxControls}, so it was not read.`,
      suggestion: 'Raise --max-controls, or capture a narrower fixture.',
    })
    return null
  }
  if (rawControls.length === 0) {
    run.add({
      file,
      ruleId: 'no-controls-declared',
      pointer: '/controls',
      message: 'This capture declares no controls, so every journey would run against nothing. A capture of nothing is not a fixture with nothing in it.',
      suggestion: 'Capture the fixture, or point --root at the capture that exists.',
    })
  }

  const controls = new Map()
  // A ref is refused for the whole document, not just for the entry that
  // collided: with three entries sharing a ref, deleting on the second would
  // let the third walk straight back into the index the second one emptied.
  const refusedControlRefs = new Set()
  for (let index = 0; index < rawControls.length; index += 1) {
    const pointer = `/controls/${index}`
    const raw = rawControls[index]
    if (!isPlainObject(raw)) {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer,
        message: `This control entry is ${shapeOf(raw)}, not an object, so it was not read. A control this run could not read is not a control that is not there.`,
        suggestion: 'Write each control as an object with a "ref".',
      })
      continue
    }
    unknownFields(run, raw, ALLOWED_CONTROL_FIELDS, file, pointer)
    if (!isUsableText(raw.ref, REF_LIMIT)) {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer: `${pointer}/ref`,
        message: `This control's ref is ${shapeOf(raw.ref)}${typeof raw.ref === 'string' ? ' that renders empty once control characters are removed' : ''}, so the control was not read.`,
        suggestion: 'Give each control a stable ref.',
      })
      continue
    }
    if (controls.has(raw.ref) || refusedControlRefs.has(raw.ref)) {
      run.addUnknown({
        file,
        ruleId: 'control-duplicate-ref',
        pointer: `${pointer}/ref`,
        message: `"${excerpt(raw.ref, REF_LIMIT)}" is declared more than once. Which entry a journey means is not something this tool will guess, so none of them was used.`,
        suggestion: 'Give each control a unique ref.',
      })
      controls.delete(raw.ref)
      refusedControlRefs.add(raw.ref)
      continue
    }
    const opens = optionalRef(run, raw.opens, file, `${pointer}/opens`, "This control's opens")
    const dismisses = optionalRef(run, raw.dismisses, file, `${pointer}/dismisses`, "This control's dismisses")
    const region = optionalRef(run, raw.region, file, `${pointer}/region`, "This control's region")
    const activatedBy = optionalTokens(run, raw.activatedBy, file, `${pointer}/activatedBy`, 'activatedBy')
    if (!opens.ok || !dismisses.ok || !region.ok || !activatedBy.ok) continue
    if (opens.value !== null && dismisses.value !== null) {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer,
        message: `"${excerpt(raw.ref, REF_LIMIT)}" declares both opens and dismisses. One control does one of the two in this model, so the entry was not used.`,
        suggestion: 'Split it into two controls, or record only the effect the journey exercises.',
      })
      continue
    }
    let tabbable = null
    if (typeof raw.tabbable === 'boolean') tabbable = raw.tabbable
    else if (raw.tabbable !== undefined && raw.tabbable !== null) {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer: `${pointer}/tabbable`,
        message: `"tabbable" is ${shapeOf(raw.tabbable)}, not a boolean, so whether Tab reaches "${excerpt(raw.ref, REF_LIMIT)}" was not read.`,
        suggestion: 'Write tabbable as true or false, or leave it out to say it was not observed.',
      })
      continue
    }
    controls.set(raw.ref, {
      ref: raw.ref,
      role: isUsableText(raw.role, 60) ? raw.role : null,
      name: typeof raw.name === 'string' ? excerpt(raw.name, 200) : null,
      tabbable,
      activatedBy: activatedBy.value,
      opens: opens.value,
      dismisses: dismisses.value,
      region: region.value,
    })
  }

  const regions = new Map()
  const refusedRegionRefs = new Set()
  const rawRegions = document.regions
  if (rawRegions !== undefined) {
    if (!Array.isArray(rawRegions)) {
      run.addUnknown({
        file,
        ruleId: 'capture-invalid',
        pointer: '/regions',
        message: `"regions" is ${shapeOf(rawRegions)}, not an array, so no region was read.`,
        suggestion: 'Write regions as an array of { "ref": "...", "modal": true } entries.',
      })
    } else {
      for (let index = 0; index < rawRegions.length; index += 1) {
        const pointer = `/regions/${index}`
        const raw = rawRegions[index]
        if (!isPlainObject(raw)) {
          run.addUnknown({
            file,
            ruleId: 'capture-invalid',
            pointer,
            message: `This region entry is ${shapeOf(raw)}, not an object, so it was not read.`,
            suggestion: 'Write each region as an object with a "ref".',
          })
          continue
        }
        unknownFields(run, raw, ALLOWED_REGION_FIELDS, file, pointer)
        if (!isUsableText(raw.ref, REF_LIMIT)) {
          run.addUnknown({
            file,
            ruleId: 'capture-invalid',
            pointer: `${pointer}/ref`,
            message: `This region's ref is ${shapeOf(raw.ref)}, so the region was not read.`,
            suggestion: 'Give each region a stable ref.',
          })
          continue
        }
        if (regions.has(raw.ref) || refusedRegionRefs.has(raw.ref)) {
          run.addUnknown({
            file,
            ruleId: 'region-duplicate-ref',
            pointer: `${pointer}/ref`,
            message: `"${excerpt(raw.ref, REF_LIMIT)}" is declared more than once. Which entry a journey means is not something this tool will guess, so none of them was used.`,
            suggestion: 'Give each region a unique ref.',
          })
          regions.delete(raw.ref)
          refusedRegionRefs.add(raw.ref)
          continue
        }
        const dismissKeys = optionalTokens(run, raw.dismissKeys, file, `${pointer}/dismissKeys`, 'dismissKeys')
        const restoresFocusTo = optionalRef(run, raw.restoresFocusTo, file, `${pointer}/restoresFocusTo`, "This region's restoresFocusTo")
        const initialFocus = optionalRef(run, raw.initialFocus, file, `${pointer}/initialFocus`, "This region's initialFocus")
        if (!dismissKeys.ok || !restoresFocusTo.ok || !initialFocus.ok) continue
        let modal = false
        if (typeof raw.modal === 'boolean') modal = raw.modal
        else if (raw.modal !== undefined) {
          run.addUnknown({
            file,
            ruleId: 'capture-invalid',
            pointer: `${pointer}/modal`,
            message: `"modal" is ${shapeOf(raw.modal)}, not a boolean, so whether "${excerpt(raw.ref, REF_LIMIT)}" confines the tab order was not read.`,
            suggestion: 'Write modal as true or false.',
          })
          continue
        }
        regions.set(raw.ref, {
          ref: raw.ref,
          role: isUsableText(raw.role, 60) ? raw.role : null,
          modal,
          dismissKeys: dismissKeys.value,
          restoresFocusTo: restoresFocusTo.value,
          initialFocus: initialFocus.value,
        })
      }
    }
  }

  return { controls, regions, activationObserved }
}

/** Read the journeys document into the steps the machine runs. */
function readJourneys(run, document, file, limits) {
  if (!checkEnvelope(run, document, file, ALLOWED_JOURNEYS_FIELDS, 'journey-invalid')) return null

  const raw = document.journeys
  if (!Array.isArray(raw)) {
    run.addUnknown({
      file,
      ruleId: 'journey-invalid',
      pointer: '/journeys',
      message: `"journeys" is ${shapeOf(raw)}, not an array, so no journey was run.`,
      suggestion: 'Write journeys as an array of { "id": "...", "steps": [...] } entries.',
    })
    return null
  }
  if (raw.length > limits.maxJourneys) {
    run.addUnknown({
      file,
      ruleId: 'too-many-journeys',
      pointer: '/journeys',
      message: `This document holds ${raw.length} journeys, past the maxJourneys limit of ${limits.maxJourneys}, so it was not read.`,
      suggestion: 'Raise --max-journeys, or split the document.',
    })
    return null
  }
  if (raw.length === 0) {
    run.add({
      file,
      ruleId: 'journeys-empty',
      pointer: '/journeys',
      message: 'This document declares no journeys, so this run checks nothing. A run with no journey is not a keyboard contract that holds.',
      suggestion: 'Declare the keyboard paths the task is meant to be doable by.',
    })
  }

  const journeys = []
  const seen = new Set()
  for (let index = 0; index < raw.length; index += 1) {
    const pointer = `/journeys/${index}`
    const entry = raw[index]
    if (!isPlainObject(entry)) {
      run.addUnknown({
        file,
        ruleId: 'journey-invalid',
        pointer,
        message: `This journey is ${shapeOf(entry)}, not an object, so it was not run.`,
        suggestion: 'Write each journey as { "id": "...", "steps": [...] }.',
      })
      continue
    }
    unknownFields(run, entry, ALLOWED_JOURNEY_FIELDS, file, pointer)
    if (!isUsableText(entry.id, REF_LIMIT)) {
      run.addUnknown({
        file,
        ruleId: 'journey-invalid',
        pointer: `${pointer}/id`,
        message: `This journey's id is ${shapeOf(entry.id)}, so it was not run.`,
        suggestion: 'Give each journey a stable id.',
      })
      continue
    }
    if (seen.has(entry.id)) {
      run.add({
        file,
        ruleId: 'journey-duplicate-id',
        pointer: `${pointer}/id`,
        message: `"${excerpt(entry.id, REF_LIMIT)}" is the id of more than one journey, so a report about it could not be read back to one path.`,
        suggestion: 'Give each journey a unique id.',
      })
      continue
    }
    seen.add(entry.id)
    if (!Array.isArray(entry.steps)) {
      run.addUnknown({
        file,
        ruleId: 'journey-invalid',
        pointer: `${pointer}/steps`,
        message: `This journey's steps is ${shapeOf(entry.steps)}, not an array, so it was not run.`,
        suggestion: 'Write steps as an array.',
      })
      continue
    }
    if (entry.steps.length > limits.maxStepsPerJourney) {
      run.addUnknown({
        file,
        ruleId: 'too-many-steps',
        pointer: `${pointer}/steps`,
        message: `This journey holds ${entry.steps.length} steps, past the maxStepsPerJourney limit of ${limits.maxStepsPerJourney}, so it was not run.`,
        suggestion: 'Raise --max-steps-per-journey, or split the journey.',
      })
      continue
    }
    if (entry.steps.length === 0) {
      run.add({
        file,
        ruleId: 'journey-without-steps',
        pointer: `${pointer}/steps`,
        message: `"${excerpt(entry.id, REF_LIMIT)}" has no steps, so running it demonstrates nothing.`,
        suggestion: 'Write the steps the journey is meant to take.',
      })
      continue
    }

    const steps = []
    let usable = true
    for (let position = 0; position < entry.steps.length; position += 1) {
      const stepPointer = `${pointer}/steps/${position}`
      const step = entry.steps[position]
      if (!isPlainObject(step)) {
        run.addUnknown({
          file,
          ruleId: 'journey-invalid',
          pointer: stepPointer,
          message: `This step is ${shapeOf(step)}, not an object, so the journey was not run. A journey run past a step this tool could not read is not the journey that was declared.`,
          suggestion: `Write each step as one of ${STEP_KINDS.map((kind) => `{ "${kind}": "..." }`).join(', ')}.`,
        })
        usable = false
        break
      }
      unknownFields(run, step, ALLOWED_STEP_FIELDS, file, stepPointer)
      const kinds = STEP_KINDS.filter((kind) => step[kind] !== undefined)
      if (kinds.length !== 1) {
        run.addUnknown({
          file,
          ruleId: 'journey-invalid',
          pointer: stepPointer,
          message: `This step declares ${kinds.length === 0 ? 'none' : kinds.length} of ${STEP_KINDS.join(', ')}, and exactly one is required, so the journey was not run.`,
          suggestion: `Write each step as one of ${STEP_KINDS.map((kind) => `{ "${kind}": "..." }`).join(', ')}.`,
        })
        usable = false
        break
      }
      const kind = kinds[0]
      const value = step[kind]
      if (!isUsableText(value, kind === 'press' ? 40 : REF_LIMIT)) {
        run.addUnknown({
          file,
          ruleId: 'journey-invalid',
          pointer: `${stepPointer}/${kind}`,
          message: `This step's "${kind}" is ${shapeOf(value)}, so the journey was not run.`,
          suggestion: kind === 'press' ? 'Write a key name, such as Enter, Space or Escape.' : 'Write the ref of a control in the capture.',
        })
        usable = false
        break
      }
      if (kind !== 'press' && step.on !== undefined) {
        run.addUnknown({
          file,
          ruleId: 'journey-invalid',
          pointer: `${stepPointer}/on`,
          message: `"on" belongs to a "press" step, and this step is a "${kind}", so the journey was not run.`,
          suggestion: 'Remove "on", or make the step a press.',
        })
        usable = false
        break
      }
      let on = null
      if (kind === 'press' && step.on !== undefined) {
        if (!isUsableText(step.on, REF_LIMIT)) {
          run.addUnknown({
            file,
            ruleId: 'journey-invalid',
            pointer: `${stepPointer}/on`,
            message: `This step's "on" is ${shapeOf(step.on)}, so the journey was not run.`,
            suggestion: 'Write the ref of a control in the capture.',
          })
          usable = false
          break
        }
        on = step.on
      }
      steps.push(kind === 'press' ? { kind, key: value, on, pointer: stepPointer } : { kind, ref: value, pointer: stepPointer })
    }
    if (!usable) continue
    journeys.push({ id: entry.id, pointer, steps })
  }
  return journeys
}

/**
 * Run the declared journeys against the declared capture.
 *
 * `monotonic` is the injected clock for the time budget. Nothing in this module
 * reads a wall clock, so the report carries no timestamp and two runs over
 * identical documents produce byte-identical stdout.
 */
export async function checkKeyboardPaths(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('options must be an object')
  for (const key of Object.keys(options).sort(byCodeUnit)) {
    if (!ALLOWED_OPTIONS.includes(key)) {
      throw new TypeError(`Unknown option "${excerpt(key, 60)}"; known options are ${[...ALLOWED_OPTIONS].sort(byCodeUnit).join(', ')}`)
    }
  }
  const limits = validateLimits(options.limits ?? {})
  const root = options.root
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('root must be a non-empty string')
  const captureName = options.capture ?? DEFAULT_CAPTURE_NAME
  const journeysName = options.journeys ?? DEFAULT_JOURNEYS_NAME
  if (!isUsableText(captureName, 512)) throw new TypeError('capture must be a usable relative path')
  if (!isUsableText(journeysName, 512)) throw new TypeError('journeys must be a usable relative path')
  const monotonic = options.monotonic ?? (() => performance.now())
  if (typeof monotonic !== 'function') throw new TypeError('monotonic must be a function')

  let realRoot
  try {
    realRoot = await realpath(resolve(root))
  } catch {
    throw new TypeError(`root "${excerpt(root, 200)}" is not a directory this run can read`)
  }

  const run = createRun(limits)
  const started = monotonic()
  const captureFile = excerpt(captureName, LOCATION_LIMIT)
  const journeysFile = excerpt(journeysName, LOCATION_LIMIT)

  const captureDocument = await readDocument(run, realRoot, captureName, captureFile, limits)
  const journeysDocument = await readDocument(run, realRoot, journeysName, journeysFile, limits)

  const model = captureDocument === undefined ? null : readCapture(run, captureDocument, captureFile, limits)
  const journeys = journeysDocument === undefined ? null : readJourneys(run, journeysDocument, journeysFile, limits)

  const results = []
  let checked = 0
  if (model !== null && journeys !== null) {
    for (const journey of journeys) {
      if (monotonic() - started >= limits.maxRuntimeMs) {
        run.addUnknown({
          file: journeysFile,
          ruleId: 'time-budget-exceeded',
          pointer: journey.pointer,
          message: 'The time budget expired before this journey was run, so it was not run. A budget that expired part way through a document is not a document whose remaining journeys hold.',
          suggestion: 'Raise --max-runtime-ms, or split the document.',
        })
        break
      }
      const outcome = runJourney(journey, model)
      checked += outcome.checked
      let incompleteHere = false
      for (const event of outcome.events) {
        const entry = {
          file: journeysFile,
          ruleId: event.ruleId,
          pointer: event.step === null ? journey.pointer : journey.steps[event.step].pointer,
          message: event.message,
          ...(event.evidence === undefined ? {} : { evidence: event.evidence }),
          ...(event.suggestion === undefined ? {} : { suggestion: event.suggestion }),
        }
        if (event.unknown) { incompleteHere = true; run.addUnknown(entry) } else run.add(entry)
      }
      results.push({
        id: excerpt(journey.id, REF_LIMIT),
        pointer: journey.pointer,
        steps: journey.steps.length,
        checked: outcome.checked,
        complete: !incompleteHere,
        endsFocusedOn: outcome.focus.known ? (outcome.focus.ref === null ? null : excerpt(outcome.focus.ref, REF_LIMIT)) : null,
        endsFocusDetermined: outcome.focus.known,
        regionsLeftOpen: outcome.stackKnown ? outcome.openRegions.map((ref) => excerpt(ref, REF_LIMIT)) : null,
      })
    }
  }

  if (checked === 0) {
    run.add({
      file: journeysFile,
      ruleId: 'nothing-checked',
      message: 'This run checked nothing: no step of any journey was run against a control this capture describes. A report over nothing is not a clean report.',
      suggestion: 'Check --root, the capture and the journeys document.',
    })
  }

  const findings = sortFindings(run.findings)
  const errors = findings.filter((finding) => finding.severity === 'error').length
  const warnings = findings.filter((finding) => finding.severity === 'warning').length
  const status = run.incomplete ? 'incomplete' : errors > 0 ? 'fail' : 'pass'

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: TOOL_ID,
    status,
    summary: {
      checked,
      errors,
      warnings,
      controls: model === null ? 0 : model.controls.size,
      regions: model === null ? 0 : model.regions.size,
      journeys: journeys === null ? 0 : journeys.length,
      journeysRun: results.length,
      journeysComplete: results.filter((entry) => entry.complete).length,
      activationObserved: model === null ? false : model.activationObserved,
      evidence: 'declared-capture',
      browserDriven: false,
      keysPressed: 0,
      screenReaderEmulated: false,
      notEvaluated: [...run.limitationsSeen].sort(byCodeUnit),
    },
    journeys: results,
    findings,
  }
}

/** The JSON report, exactly as it reaches stdout. */
export function serializeReport(report) {
  return JSON.stringify(report, null, 2)
}

/** 0 pass, 1 fail, 2 incomplete. An incomplete run is never a pass. */
export function exitCodeFor(report) {
  if (report.status === 'incomplete') return 2
  return report.status === 'fail' ? 1 : 0
}

const SEVERITY_MARK = Object.freeze({ error: 'ERROR  ', warning: 'WARN   ', info: 'INFO   ' })

/**
 * The human summary. It goes to stderr; stdout carries the JSON and nothing
 * else.
 *
 * Note what no line here says: nothing calls a journey verified, nothing claims
 * a key was pressed, and nothing says what a screen reader announced. The
 * widest claim the evidence supports is "the declared capture says this journey
 * holds".
 */
export function formatReport(report) {
  const summary = report.summary
  const lines = []
  lines.push(`${TOOL_ID}: ${report.status}`)
  lines.push(`  ${summary.checked} step(s) checked, ${summary.errors} error(s), ${summary.warnings} warning(s)`)
  lines.push(
    `  ${summary.journeysRun}/${summary.journeys} journey(s) run against ${summary.controls} declared control(s) `
    + `and ${summary.regions} declared region(s); ${summary.journeysComplete} ran on complete evidence`,
  )
  lines.push(
    '  evidence is a declared capture: no browser was driven, no key was pressed, no focus was observed '
    + 'and no screen reader was emulated',
  )
  if (!summary.activationObserved) {
    lines.push('  this capture does not claim activation was observed, so no key was judged to fail on it')
  }
  if (summary.notEvaluated.length > 0) lines.push(`  not evaluated: ${summary.notEvaluated.join(', ')}`)
  for (const journey of report.journeys) {
    lines.push(
      `  journey ${journey.id}: ${journey.checked} checked, `
      + `${journey.complete ? 'complete' : 'incomplete'}, ends on `
      + `${journey.endsFocusDetermined ? (journey.endsFocusedOn ?? 'nothing') : 'an undetermined control'}`,
    )
  }
  for (const finding of report.findings) {
    const where = finding.location.pointer === '' ? finding.location.file : `${finding.location.file} ${finding.location.pointer}`
    lines.push(`  ${SEVERITY_MARK[finding.severity]}${finding.ruleId}  ${where}`)
    lines.push(`         ${finding.message}`)
  }
  return `${lines.join('\n')}\n`
}
