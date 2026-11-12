import type { Detail, OptionValue, StepOption } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { StepRecord } from "#session/session.ts"

// Name the options at level 1, because they say how the step ran, not what it changed.
const OPTIONS_LEVEL: Verbosity = 1
// Show their values from level 2, because the values are detail about how it ran.
const OPTION_VALUES_LEVEL: Verbosity = 2

const toOptionValue = (value: string | boolean): OptionValue => ({ value, from: OPTION_VALUES_LEVEL })

/** Returns `env` or `secretEnv` as an option with an entry per variable, or none when it has no variables. */
const toVariablesOptions = (name: "env" | "secretEnv", variables: Record<string, string>): StepOption[] => {
  const entries = Object.entries(variables).map(([variableName, value]) => ({
    name: variableName,
    value: toOptionValue(value),
    entries: [],
  }))
  return entries.length > 0 ? [{ name, entries }] : []
}

/** Returns the options the step set that change how its commands ran, as one detail, or none when it set none. */
export const toOptionsDetails = (stepRecord: StepRecord): Detail[] => {
  const { sudo, env, secretEnv } = stepRecord.shellOptions
  const sudoOptions: StepOption[] = sudo ? [{ name: "sudo", value: toOptionValue(true), entries: [] }] : []
  const options = [...sudoOptions, ...toVariablesOptions("env", env), ...toVariablesOptions("secretEnv", secretEnv)]

  return options.length > 0 ? [{ kind: "options", options, from: OPTIONS_LEVEL }] : []
}
