/**
 * The journey machine.
 *
 * A declared journey is run against a DECLARED CAPTURE -- a document somebody
 * exported describing the controls and regions of a fixture. No browser is
 * opened, no key is pressed and no focus is observed. Everything this module
 * concludes is a statement about those two documents.
 *
 * The machine's whole design is about one distinction, because getting it wrong
 * is how an accessibility tool reports a clean run on evidence it could not
 * read:
 *
 * - **Known.** The capture says what happens, and the journey either matches it
 *   or does not. That is a pass or a fail.
 * - **Undetermined.** The capture does not say. Focus then becomes UNKNOWN, and
 *   an unknown focus is never compared against an expectation -- not as a match
 *   and not as a mismatch. The region stack becomes unknown with it, so a
 *   journey that ends with an unverifiable stack is never reported as having
 *   left a region open, and never reported as having closed one.
 *
 * Nothing here reads a clock, the filesystem, the environment or the network,
 * so a journey is a pure function of the two documents.
 */

import { excerpt } from './text.mjs'

/** The step kinds this module runs. A step outside them is refused, not guessed. */
export const STEP_KINDS = Object.freeze(['tabTo', 'press', 'expectFocus'])

const REF_LIMIT = 120
const KEY_LIMIT = 40

function unknownFocus(reason) {
  return { known: false, reason }
}

/**
 * Run one journey.
 *
 * Returns the events it produced, in step order, plus how many things it
 * actually checked. An event carrying `unknown: true` means the run wanted
 * evidence and did not get it; the caller turns those into `incomplete`.
 */
export function runJourney(journey, model) {
  const events = []
  let focus = { known: true, ref: null }
  let open = []
  let stackKnown = true
  let lastWasDismissal = false
  let checked = 0

  const emit = (step, ruleId, message, extra = {}) => {
    events.push({ step, ruleId, message, unknown: extra.unknown === true, ...extra })
  }

  const confiningRegion = () => {
    for (let index = open.length - 1; index >= 0; index -= 1) {
      const region = model.regions.get(open[index])
      if (region !== undefined && region.modal) return open[index]
    }
    return null
  }

  const resolveControl = (step, ref, what, tail) => {
    const control = model.controls.get(ref)
    if (control !== undefined) return control
    emit(step, 'control-undeclared', `${what} "${excerpt(ref, REF_LIMIT)}", and this capture does not describe it. ${tail}`, {
      unknown: true,
      suggestion: 'Add the control to the capture, or correct the ref.',
    })
    focus = unknownFocus(`a step named the control "${excerpt(ref, REF_LIMIT)}", which this capture does not describe`)
    stackKnown = false
    return null
  }

  const dismissRegion = (step, regionRef, how) => {
    const region = model.regions.get(regionRef)
    if (region === undefined) {
      emit(step, 'region-undeclared', `${how} dismisses the region "${excerpt(regionRef, REF_LIMIT)}", and this capture does not describe it.`, {
        unknown: true,
        suggestion: 'Add the region to the capture, or correct the ref.',
      })
      focus = unknownFocus(`a step dismissed the region "${excerpt(regionRef, REF_LIMIT)}", which this capture does not describe`)
      stackKnown = false
      return
    }
    if (!stackKnown) {
      focus = unknownFocus('an earlier step left it undetermined which regions are open')
      return
    }
    if (open.length === 0 || open.at(-1) !== regionRef) {
      emit(step, 'dismiss-wrong-region', `${how} dismisses "${excerpt(regionRef, REF_LIMIT)}", and the region open here is ${open.length === 0 ? 'none' : `"${excerpt(open.at(-1), REF_LIMIT)}"`}. A region cannot be dismissed from behind another one.`, {
        suggestion: 'Dismiss the innermost region first, or correct the journey.',
      })
      focus = unknownFocus('a step dismissed a region that was not the innermost open one')
      stackKnown = false
      return
    }
    open = open.slice(0, -1)
    lastWasDismissal = true
    if (region.restoresFocusTo === null) {
      emit(step, 'focus-return-not-declared', `"${excerpt(regionRef, REF_LIMIT)}" does not declare restoresFocusTo, so where focus goes when it closes is not in this capture. It is not therefore left where it was.`, {
        unknown: true,
        suggestion: 'Record restoresFocusTo for the region, from a keyboard walk of the fixture.',
      })
      focus = unknownFocus(`"${excerpt(regionRef, REF_LIMIT)}" does not declare where focus returns to`)
      return
    }
    if (resolveControl(step, region.restoresFocusTo, `"${excerpt(regionRef, REF_LIMIT)}" restores focus to`, 'Where focus went was not checked.') === null) return
    focus = { known: true, ref: region.restoresFocusTo }
  }

  const applyEffect = (step, control) => {
    if (control.opens !== null) {
      const region = model.regions.get(control.opens)
      if (region === undefined) {
        emit(step, 'region-undeclared', `"${excerpt(control.ref, REF_LIMIT)}" opens the region "${excerpt(control.opens, REF_LIMIT)}", and this capture does not describe it.`, {
          unknown: true,
          suggestion: 'Add the region to the capture, or correct the ref.',
        })
        focus = unknownFocus(`a step opened the region "${excerpt(control.opens, REF_LIMIT)}", which this capture does not describe`)
        stackKnown = false
        return
      }
      open = [...open, region.ref]
      lastWasDismissal = false
      if (region.initialFocus === null) {
        emit(step, 'region-without-initial-focus', `"${excerpt(region.ref, REF_LIMIT)}" does not declare initialFocus, so where focus goes when it opens is not in this capture.`, {
          unknown: true,
          suggestion: 'Record initialFocus for the region, from a keyboard walk of the fixture.',
        })
        focus = unknownFocus(`"${excerpt(region.ref, REF_LIMIT)}" does not declare where focus goes when it opens`)
        return
      }
      if (resolveControl(step, region.initialFocus, `"${excerpt(region.ref, REF_LIMIT)}" takes focus to`, 'Where focus went was not checked.') === null) return
      focus = { known: true, ref: region.initialFocus }
      return
    }
    if (control.dismisses !== null) {
      dismissRegion(step, control.dismisses, `"${excerpt(control.ref, REF_LIMIT)}"`)
      return
    }
    lastWasDismissal = false
  }

  const reach = (step, ref) => {
    const control = resolveControl(step, ref, 'This step names the control', 'The step was not run.')
    if (control === null) return null
    checked += 1
    if (control.tabbable === null) {
      emit(step, 'tabbable-undetermined', `This capture does not say whether "${excerpt(ref, REF_LIMIT)}" is reachable by Tab, so the step was not run. Not stated is not the same as not reachable.`, {
        unknown: true,
        suggestion: 'Record tabbable for the control, from a keyboard walk of the fixture.',
      })
      focus = unknownFocus(`whether "${excerpt(ref, REF_LIMIT)}" can be reached by Tab is not in this capture`)
      return null
    }
    if (!control.tabbable) {
      emit(step, 'control-not-reachable', `This journey reaches "${excerpt(ref, REF_LIMIT)}" by keyboard, and this capture records it as not reachable by Tab.`, {
        suggestion: 'Put the control in the tab order, or take the step out of the journey.',
      })
      focus = unknownFocus(`"${excerpt(ref, REF_LIMIT)}" could not be reached, so focus did not move there`)
      return null
    }
    const confining = confiningRegion()
    if (stackKnown && confining !== null && control.region !== confining) {
      emit(step, 'unreachable-behind-modal', `This journey reaches "${excerpt(ref, REF_LIMIT)}" while the modal region "${excerpt(confining, REF_LIMIT)}" is open, and this capture places that control ${control.region === null ? 'outside any region' : `in "${excerpt(control.region, REF_LIMIT)}"`}. A modal region confines the tab order to itself.`, {
        suggestion: 'Dismiss the region first, or correct the journey.',
      })
      focus = unknownFocus(`"${excerpt(ref, REF_LIMIT)}" is behind an open modal region, so focus did not move there`)
      return null
    }
    focus = { known: true, ref }
    lastWasDismissal = false
    return control
  }

  const activate = (step, control, key) => {
    checked += 1
    if (control.activatedBy === null) {
      emit(step, 'activation-undetermined', `This capture does not record how "${excerpt(control.ref, REF_LIMIT)}" is activated, so pressing ${excerpt(key, KEY_LIMIT)} on it was not checked. Not recorded is not the same as not working.`, {
        unknown: true,
        suggestion: 'Record activatedBy for the control, from a keyboard walk of the fixture.',
      })
      focus = unknownFocus(`what pressing ${excerpt(key, KEY_LIMIT)} on "${excerpt(control.ref, REF_LIMIT)}" does is not in this capture`)
      stackKnown = false
      return
    }
    if (!model.activationObserved) {
      emit(step, 'activation-undetermined', `This capture declares activationObserved false, so its activatedBy list for "${excerpt(control.ref, REF_LIMIT)}" is what somebody happened to try -- not what does and does not work. Pressing ${excerpt(key, KEY_LIMIT)} on it was not checked.`, {
        unknown: true,
        suggestion: 'Re-capture with every declared key actually tried, then set activationObserved true.',
      })
      focus = unknownFocus(`this capture did not observe activation, so what pressing ${excerpt(key, KEY_LIMIT)} on "${excerpt(control.ref, REF_LIMIT)}" does is undetermined`)
      stackKnown = false
      return
    }
    if (control.activatedBy.includes(key)) {
      applyEffect(step, control)
      return
    }
    const keyboard = control.activatedBy.filter((entry) => entry !== 'pointer')
    if (keyboard.length === 0) {
      // An empty activatedBy is not "pointer only": the capture recorded
      // nothing that activates this control, and saying "pointer only" would
      // put a fact in the report that the capture does not contain. The rule id
      // covers both, because both are the same defect -- no keyboard way in.
      const what = control.activatedBy.length === 0
        ? 'records nothing at all as activating it'
        : `records it as activated by ${control.activatedBy.map((entry) => excerpt(entry, KEY_LIMIT)).join(', ')} and by no key`
      emit(step, 'pointer-only-activation', `This journey activates "${excerpt(control.ref, REF_LIMIT)}" with ${excerpt(key, KEY_LIMIT)}, and this capture -- which did observe activation -- ${what}. A control a keyboard cannot activate does not meet its keyboard contract.`, {
        evidence: control.activatedBy.length === 0
          ? 'activatedBy: (empty)'
          : `activatedBy: ${control.activatedBy.map((entry) => excerpt(entry, KEY_LIMIT)).join(', ')}`,
        suggestion: 'Use a button element, or add a keydown handler for Enter and Space alongside the click handler.',
      })
      return
    }
    emit(step, 'key-not-activating', `This journey activates "${excerpt(control.ref, REF_LIMIT)}" with ${excerpt(key, KEY_LIMIT)}, and this capture -- which did observe activation -- records it as activated by ${keyboard.map((entry) => excerpt(entry, KEY_LIMIT)).join(', ')}.`, {
      evidence: `activatedBy: ${control.activatedBy.map((entry) => excerpt(entry, KEY_LIMIT)).join(', ')}`,
      suggestion: 'Handle the key the journey uses, or correct the journey.',
    })
  }

  const pressWithoutTarget = (step, key) => {
    checked += 1
    if (!stackKnown) {
      emit(step, 'focus-undetermined', `Pressing ${excerpt(key, KEY_LIMIT)} here was not checked: an earlier step left it undetermined which regions are open.`, {
        unknown: true,
        suggestion: 'Resolve the earlier findings and run again.',
      })
      return
    }
    if (open.length === 0) {
      emit(step, 'step-without-effect', `This step presses ${excerpt(key, KEY_LIMIT)} with no control to press it on and no region open to dismiss, so it does nothing this capture can describe.`, {
        suggestion: 'Give the step an "on" ref, or open a region first.',
      })
      return
    }
    const regionRef = open.at(-1)
    const region = model.regions.get(regionRef)
    if (region === undefined) {
      emit(step, 'region-undeclared', `The region open here is "${excerpt(regionRef, REF_LIMIT)}", and this capture does not describe it.`, {
        unknown: true,
        suggestion: 'Add the region to the capture.',
      })
      focus = unknownFocus('a region this capture does not describe was open')
      stackKnown = false
      return
    }
    if (region.dismissKeys === null) {
      emit(step, 'dismiss-keys-not-declared', `"${excerpt(regionRef, REF_LIMIT)}" does not declare dismissKeys, so whether ${excerpt(key, KEY_LIMIT)} closes it is not in this capture. Not declared is not the same as not closing it.`, {
        unknown: true,
        suggestion: 'Record dismissKeys for the region, from a keyboard walk of the fixture.',
      })
      focus = unknownFocus(`whether ${excerpt(key, KEY_LIMIT)} closes "${excerpt(regionRef, REF_LIMIT)}" is not in this capture`)
      stackKnown = false
      return
    }
    if (!region.dismissKeys.includes(key)) {
      emit(step, 'key-does-not-dismiss', `This journey closes "${excerpt(regionRef, REF_LIMIT)}" with ${excerpt(key, KEY_LIMIT)}, and this capture records it as closed by ${region.dismissKeys.map((entry) => excerpt(entry, KEY_LIMIT)).join(', ') || 'no key at all'}.`, {
        suggestion: 'Handle the key, or correct the journey.',
      })
      return
    }
    dismissRegion(step, regionRef, `Pressing ${excerpt(key, KEY_LIMIT)}`)
  }

  const expectFocus = (step, ref) => {
    checked += 1
    if (!focus.known) {
      emit(step, 'focus-undetermined', `Where focus is here is undetermined: ${focus.reason}. Nothing was compared -- this is not a match and not a mismatch.`, {
        unknown: true,
        suggestion: 'Resolve the findings that made it undetermined and run again.',
      })
      return
    }
    if (focus.ref === ref) return
    const where = focus.ref === null ? 'nothing was focused yet' : `this capture puts it on "${excerpt(focus.ref, REF_LIMIT)}"`
    if (lastWasDismissal) {
      emit(step, 'focus-not-restored', `After the region closed, this journey expects focus on "${excerpt(ref, REF_LIMIT)}" and ${where}. Focus that does not come back to the control that opened a dialog strands a keyboard user.`, {
        suggestion: 'Record restoresFocusTo as the control that opens the region, and make the fixture do it.',
      })
      return
    }
    emit(step, 'focus-mismatch', `This journey expects focus on "${excerpt(ref, REF_LIMIT)}" and ${where}.`, {
      suggestion: 'Correct the journey, or correct the capture.',
    })
  }

  for (let index = 0; index < journey.steps.length; index += 1) {
    const step = journey.steps[index]
    if (step.kind === 'tabTo') {
      reach(index, step.ref)
    } else if (step.kind === 'press') {
      if (step.on === null) pressWithoutTarget(index, step.key)
      else {
        const control = reach(index, step.on)
        if (control !== null) activate(index, control, step.key)
      }
    } else {
      expectFocus(index, step.ref)
    }
  }

  if (stackKnown && open.length > 0) {
    events.push({
      step: null,
      ruleId: 'region-left-open',
      unknown: false,
      message: `This journey ends with ${open.map((ref) => `"${excerpt(ref, REF_LIMIT)}"`).join(', ')} still open. A journey that opens a dialog and never closes it does not demonstrate the close path.`,
      suggestion: 'Add the step that dismisses the region, and the expectation that focus comes back.',
    })
  }

  return { events, checked, focus, openRegions: open, stackKnown }
}
