import type { Detail, OptionValue, StepOption } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { StepOptionsRecord, StepRecord } from "#session/session.ts"

// Name the options at level 2, with the commands, because they say how the step ran, not what it changed.
const OPTIONS_LEVEL: Verbosity = 2
// Show their values from level 3, because the values are detail about how it ran.
const OPTION_VALUES_LEVEL: Verbosity = 3

const toOptionValue = (value: string | boolean): OptionValue => ({ value, from: OPTION_VALUES_LEVEL })

type OptionsRecordValue = NonNullable<StepOptionsRecord[keyof StepOptionsRecord]>

/** Returns an option as a node: a flag or a text as its value, or variables like `env`'s as an entry each. */
const toStepOption = (name: string, value: OptionsRecordValue): StepOption => {
  if (typeof value === "string" || typeof value === "boolean") return { name, value: toOptionValue(value), entries: [] }

  const entries = Object.entries(value).map(([entryName, entryValue]) => toStepOption(entryName, entryValue))
  return { name, entries }
}

/** Returns the options the step set that the report shows, as one detail, or none when it set none. */
export const toOptionsDetails = (stepRecord: StepRecord): Detail[] => {
  const recordedOptions = Object.entries(stepRecord.options).filter(
    (entry): entry is [string, OptionsRecordValue] => entry[1] !== undefined,
  )
  const options = recordedOptions.map(([name, value]) => toStepOption(name, value))
  return options.length > 0 ? [{ kind: "options", options, from: OPTIONS_LEVEL }] : []
}
