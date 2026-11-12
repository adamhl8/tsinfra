import { toCommandsDetail, toCommandsDetails } from "#report/host-block/details/commands.ts"
import { toComparisonValuesDetails } from "#report/host-block/details/comparisons.ts"
import { toFailedStepDetails } from "#report/host-block/details/failure.ts"
import { toOptionsDetails } from "#report/host-block/details/options.ts"
import type { Detail } from "#report/host-block/host-block.ts"
import type { CommandRecord, ComparisonValues, FinishedStepRecord, StepRecord } from "#session/session.ts"

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

/** Returns a failure's hints, which show last under its error. */
export const toHintDetails = (hints: string[]): Detail[] => hints.map((text) => ({ kind: "hint", text, from: 0 }))

/**
 * Returns a finished step's details: its options, how a changed step's value would change, any warnings, then its
 * commands.
 */
export const toStepDetails = (stepRecord: FinishedStepRecord): Detail[] => {
  const { status, comparisons } = stepRecord
  const optionsDetails = toOptionsDetails(stepRecord)
  const commandsDetails = toCommandsDetails(stepRecord)

  if (status === "waiting") return [...optionsDetails, ...commandsDetails]

  const values = comparisons.before?.values
  // Show how a changed step's value would change, when its name doesn't already say.
  const showsChange = status === "changed" && values !== undefined && SHOWS_CHANGE_DETAILS[values.kind]
  const changeDetails = showsChange ? toComparisonValuesDetails(values, 0) : []
  const warningDetails = toWarningDetails(stepRecord)
  return [...optionsDetails, ...changeDetails, ...warningDetails, ...commandsDetails]
}

const HOST_FUNCTION_FAILURE_NOTE = "thrown in the host function, outside any step"

/** Returns what a failed step shows under its error, before any hints: its options, what it found, and its commands. */
export const toStepFailureDetails = (stepRecord: StepRecord): Detail[] => {
  const optionsDetails = toOptionsDetails(stepRecord)
  const failedStepDetails = toFailedStepDetails(stepRecord)
  const commandsDetails = toCommandsDetails(stepRecord)
  return [...optionsDetails, ...failedStepDetails, ...commandsDetails]
}

/**
 * Returns what a preparation failure shows under its error, before any hints: the commands preparation ran, so it shows
 * how far preparation got. A host that was prepared lists none, because the same commands would repeat in every block.
 */
export const toPreparationFailureDetails = (preparationCommands: CommandRecord[]): Detail[] =>
  toCommandsDetail(preparationCommands)

/**
 * Returns what a host function failure shows under its error, before any hints: a note, because `host fn` alone doesn't
 * say it came from the script and not the host.
 */
export const toHostFunctionFailureDetails = (): Detail[] => [
  { kind: "note", text: HOST_FUNCTION_FAILURE_NOTE, from: 0 },
]
