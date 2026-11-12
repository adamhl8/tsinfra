import { toComparisonValuesDetails } from "#report/host-block/details/comparisons.ts"
import { toFailedStepDetails } from "#report/host-block/details/failure.ts"
import type { Detail } from "#report/host-block/host-block.ts"
import type { ComparisonValues, FinishedStepRecord, RecordedFailure } from "#session/session.ts"

// Show how a string value, a file, or a link would change, because the step's name doesn't say.
// A boolean or an exit code needs no details, because the name already says what yes and no mean.
const SHOWS_CHANGE_DETAILS: Record<ComparisonValues["kind"], boolean> = {
  string: true,
  boolean: false,
  exit: false,
  file: true,
  link: true,
}

// Point the words at the target, which follows them in the value color.
const MISSING_TARGET_TEXT = "nothing exists at target ->"

/**
 * Returns what a finished step warns about, from its latest comparison, so `apply` warns about the state it left. It
 * takes only a finished step, because a failed step's error is what needs fixing first.
 */
const toWarningDetails = (stepRecord: FinishedStepRecord): Detail[] => {
  const { comparisons } = stepRecord
  const values = (comparisons.after ?? comparisons.before)?.values

  if (values?.kind === "link" && !values.targetExists) {
    const warning = { text: MISSING_TARGET_TEXT, value: values.target }
    return [{ kind: "warning", warning, from: 0 }]
  }

  return []
}

const toHintDetails = (hints: string[]): Detail[] => hints.map((text) => ({ kind: "hint", text, from: 0 }))

/** Returns a finished step's details: how a changed step's value would change, then any warnings. */
export const toStepDetails = (stepRecord: FinishedStepRecord): Detail[] => {
  const { status, comparisons } = stepRecord
  if (status === "waiting") return []

  const values = comparisons.before?.values
  // Show how a changed step's value would change, when its name doesn't already say.
  const showsChange = status === "changed" && values !== undefined && SHOWS_CHANGE_DETAILS[values.kind]
  const changeDetails = showsChange ? toComparisonValuesDetails(values, 0) : []
  return [...changeDetails, ...toWarningDetails(stepRecord)]
}

const HOST_FUNCTION_FAILURE_NOTE = "thrown in the host function, outside any step"

/** Returns what a failure shows under its error: what a failed step found, or a note, then any hints. */
export const toFailureDetails = (failure: RecordedFailure): Detail[] => {
  const hintDetails = toHintDetails(failure.hints)

  if (failure.kind === "step") return [...toFailedStepDetails(failure.stepRecord), ...hintDetails]

  // Add a note to a host function failure, because `host fn` alone doesn't say it came from the script and not the host.
  const noteDetails: Detail[] =
    failure.kind === "host fn" ? [{ kind: "note", text: HOST_FUNCTION_FAILURE_NOTE, from: 0 }] : []
  return [...noteDetails, ...hintDetails]
}
