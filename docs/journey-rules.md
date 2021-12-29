# keyboard-path-checker rule catalog

Every rule this tool can report, its frozen severity, and whether it means the
run did not obtain evidence.

`severity` decides the exit code: one `error` makes the run fail. A rule marked
**limitation** is raised through `addUnknown`, which is the single place
`incomplete` is set, and an `incomplete` run exits 2 whatever its severities
are. Several limitation rules are `warning`, and for those the `incomplete` flag
is the ONLY thing standing between the run and a green exit 0 --
`test/incomplete.test.mjs` exists because of that.

The severities below are cross-checked against `RULE_SEVERITY` in both
directions by `test/rule-catalog.test.mjs`. That check is a consistency check
and not the defence: a table, a document and a test's expected map are three
declarations one coordinated edit satisfies. The defence is
`test/severity-outcomes.test.mjs`, which drives real documents through the real
CLI and asserts the exit code.

## Reading the documents

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `capture-invalid` | error | yes | A field of the capture is the wrong shape, so the entry it belongs to was not used. An entry this run could not read is not an entry that is not there. |
| `capture-not-declared` | warning | yes | The capture declares no `capture` block, so whether anybody really tried each key is not stated. Every activation becomes undetermined. |
| `control-duplicate-ref` | error | yes | One ref on more than one control. Which entry a journey means is not guessed, so none of them was used -- and the ref stays refused for the rest of the document, whether the entry that named it was a duplicate or malformed, so a later entry cannot walk back into the index. |
| `input-not-json` | error | yes | A document is not valid JSON. The detail says where the parse failed and never reproduces the document. |
| `input-not-utf8` | error | yes | A document is not valid UTF-8. The decoder decides, not a search of decoded text for a replacement character. |
| `input-too-large` | error | yes | A document is past `maxDocumentBytes`. It was not parsed. |
| `input-unreadable` | error | yes | A document could not be opened. |
| `journey-invalid` | error | yes | A journey or one of its steps is the wrong shape, so the journey was not run. A journey run past a step this tool could not read is not the journey that was declared. |
| `path-escapes-root` | error | yes | A document resolves outside `--root`. A symbolic link inside the root is still a way out of it. |
| `region-duplicate-ref` | error | yes | One ref on more than one region. As above, none of them is used and the ref stays refused however the earlier entry was lost. |
| `schema-version-unsupported` | error | yes | A document declares a `schemaVersion` this tool does not read. It was not interpreted. |
| `unknown-field` | error | yes | A field this tool does not read. A one-character typo would silently switch a check off, so it is refused rather than ignored. |

## Limits

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `time-budget-exceeded` | error | yes | `maxRuntimeMs` expired before a journey was run. A budget that expired part way through is not a document whose remaining journeys hold. |
| `too-many-controls` | error | yes | More controls than `maxControls`. |
| `too-many-findings` | error | yes | More findings than `maxFindings`. What was dropped is not known to be clean. |
| `too-many-journeys` | error | yes | More journeys than `maxJourneys`. |
| `too-many-steps` | error | yes | More steps in one journey than `maxStepsPerJourney`. |

## Reachability

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `control-not-reachable` | error | no | The journey reaches a control the capture records as `tabbable: false`. |
| `control-undeclared` | error | yes | A step names a control the capture does not describe, so the step was not run and focus became undetermined. |
| `tabbable-undetermined` | warning | yes | The capture does not say whether Tab reaches the control. Not stated is not the same as not reachable. |
| `modal-not-declared` | warning | yes | A region is open and the capture does not declare whether it is modal, so whether the tab order is confined to it is not in the capture. Not declared is not the same as not modal. |
| `unreachable-behind-modal` | error | no | The journey tabs to a control the capture does not place inside the modal region that is open. A modal region confines the tab order to itself. |

## Activation

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `activation-undetermined` | warning | yes | The capture records no `activatedBy` for the control, or declares `activationObserved` false. Either way its list is what somebody happened to press, not what works, so nothing was judged. |
| `key-not-activating` | error | no | The capture **did** observe activation, and the key the journey uses is not one of the keys that activate the control. |
| `pointer-only-activation` | error | no | The capture **did** observe activation, and it records no key that activates the control -- either pointer only, or nothing at all. A control a keyboard cannot activate does not meet its keyboard contract. |

## Dismissal and focus return

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `dismiss-keys-not-declared` | warning | yes | The region declares no `dismissKeys`, so whether the key closes it is not in the capture. Not declared is not the same as not closing it. |
| `dismiss-wrong-region` | error | no | The journey dismisses a region that is not the innermost open one. |
| `focus-mismatch` | error | no | An `expectFocus` step does not match where the capture puts focus. |
| `focus-not-restored` | error | no | After a region closed, focus is not where the journey expects it. Focus that does not come back to the control that opened a dialog strands a keyboard user. |
| `focus-return-not-declared` | warning | yes | The region declares no `restoresFocusTo`, so where focus goes when it closes is not in the capture. It is not therefore left where it was. |
| `focus-undetermined` | warning | yes | Focus is undetermined at an `expectFocus`, or the region stack is undetermined at a bare `press`. Nothing was compared -- not a match and not a mismatch. |
| `key-does-not-dismiss` | error | no | The journey closes a region with a key the capture does not record as closing it. |
| `region-left-open` | error | no | The journey ends with a region still open. A journey that opens a dialog and never closes it does not demonstrate the close path. |
| `region-undeclared` | error | yes | A control opens or dismisses a region the capture does not describe. |
| `region-without-initial-focus` | warning | yes | The region declares no `initialFocus`, so where focus goes when it opens is not in the capture. |
| `step-without-effect` | error | no | A bare `press` with no control to press it on and no region open to dismiss. |

## The run itself

| ruleId | severity | limitation | what it means |
| --- | --- | :---: | --- |
| `journey-duplicate-id` | error | no | Two journeys share an id, so a report about it could not be read back to one path. |
| `journey-without-steps` | error | no | A journey with no steps demonstrates nothing. |
| `journeys-empty` | error | no | No journeys at all. A run with no journey is not a keyboard contract that holds. |
| `no-controls-declared` | error | no | The capture declares no controls. A capture of nothing is not a fixture with nothing in it. |
| `nothing-checked` | error | no | No step of any journey ran against a control the capture describes. |

## The capture document

```json
{
  "schemaVersion": "1",
  "capture": { "method": "manual keyboard walk", "activationObserved": true },
  "controls": [
    {
      "ref": "delete-order",
      "role": "button",
      "name": "Delete order",
      "tabbable": true,
      "activatedBy": ["Enter", "Space", "pointer"],
      "opens": "confirm-dialog"
    },
    {
      "ref": "confirm-cancel",
      "tabbable": true,
      "activatedBy": ["Enter", "Space", "pointer"],
      "dismisses": "confirm-dialog",
      "region": "confirm-dialog"
    }
  ],
  "regions": [
    {
      "ref": "confirm-dialog",
      "role": "dialog",
      "modal": true,
      "dismissKeys": ["Escape"],
      "initialFocus": "confirm-cancel",
      "restoresFocusTo": "delete-order"
    }
  ]
}
```

- `activationObserved` is a claim about the capture, not about the fixture. Set
  it `true` only once every key in every `activatedBy` list and every
  `dismissKeys` list has really been pressed, and the ones that do nothing have
  really been tried. With it `false` -- or absent -- no key is ever judged to
  fail, and every activation the journeys reach is `activation-undetermined`.
- `activationObserved` covers dismissal as well as activation. With it `false`
  or absent no control ever activates, so no region is ever opened and no
  `dismissKeys` list is ever judged either: `key-does-not-dismiss` cannot be
  reached from a capture that did not observe activation.
  `test/confinement.test.mjs` pins that.
- `tabbable`, `activatedBy`, `modal`, `dismissKeys`, `initialFocus` and
  `restoresFocusTo` may all be left out. Leaving one out says "not observed",
  and the checks that need it become undetermined rather than passing. Writing
  `null` says the same thing as leaving it out.
- `region`, `opens` and `dismisses` are the other shape, and the difference is
  deliberate. The five fields above are **observations**: whether Tab reaches a
  control, whether a key activates it, whether a region confines the tab order --
  each needs somebody to have tried it, so silence about one cannot be read as a
  "no". These three are **structure**: which region a control belongs to, and
  which region it opens or closes. A capture lists its regions and puts controls
  in them, so a control with no `region` is one this document places in no
  region, exactly as a control with no `opens` is one it says opens nothing.
  That default is a statement the document makes, and `unreachable-behind-modal`
  says which of the two it read.
- A control declares `opens` **or** `dismisses`, not both.
- `role`, `name`, `capture.method` and a journey's `description` are the
  documents' own words for the reader. This tool checks their shape and never
  reports, echoes, computes or compares them; see the non-goals in the README.
  They are still refused rather than ignored when malformed, because a field
  accepted without a check is a field a typo can put anything in. Each must be
  text that survives sanitising: at most 60 characters for `role`, 200 for
  `name` and `method`, 400 for a `description`.
- Unknown fields at any level are refused, not ignored.

## The journeys document

```json
{
  "schemaVersion": "1",
  "journeys": [
    {
      "id": "open-and-escape",
      "description": "Escape closes the dialog and focus comes back.",
      "steps": [
        { "tabTo": "delete-order" },
        { "press": "Enter", "on": "delete-order" },
        { "expectFocus": "confirm-cancel" },
        { "press": "Escape" },
        { "expectFocus": "delete-order" }
      ]
    }
  ]
}
```

Exactly three step kinds, and a step declares exactly one of them:

| Step | What it checks |
| --- | --- |
| `{ "tabTo": ref }` | The control exists in the capture, is `tabbable`, and is not behind an open region the capture declares modal. Focus moves there. An open region whose `modal` the capture never declares makes the step `modal-not-declared` instead of either verdict. |
| `{ "press": key, "on": ref }` | Everything `tabTo` checks, then activation: whether that key activates the control. The declared effect -- opening or dismissing a region -- is then applied. |
| `{ "press": key }` | The key against the innermost open region's `dismissKeys`. |
| `{ "expectFocus": ref }` | Where the capture puts focus, against where the journey expects it. An undetermined focus is not compared. |
