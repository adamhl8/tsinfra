import type { Detail, StepOptionDetail } from "#report/host-block/host-block.ts"
import type { StepRecord } from "#session/session.ts"

const toVariablesOptions = (name: "env" | "secretEnv", variables: Record<string, string>): StepOptionDetail[] =>
  Object.keys(variables).length > 0 ? [{ name, variables }] : []

/** Returns the options the step set that change how its commands ran, as one detail, or none when it set none. */
export const toOptionsDetails = (stepRecord: StepRecord): Detail[] => {
  const { sudo, env, secretEnv } = stepRecord.shellOptions
  const sudoOptions: StepOptionDetail[] = sudo ? [{ name: "sudo" }] : []
  const options = [...sudoOptions, ...toVariablesOptions("env", env), ...toVariablesOptions("secretEnv", secretEnv)]

  // Show the options from level 1, because they say how the step ran, not what it changed.
  return options.length > 0 ? [{ kind: "options", options, from: 1 }] : []
}
