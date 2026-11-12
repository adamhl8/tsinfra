import type { StepOptionDetail } from "#report/host-block/host-block.ts"
import { styleLabel, styleNote, styleValue } from "#styles.ts"

/** Formats one option for the options line: its name, and for `env` or `secretEnv`, its variables' names. */
const formatOptionsLinePart = (option: StepOptionDetail): string => {
  if (option.name === "sudo") return styleLabel(option.name)

  // Name each variable without its value, because the values show at level 2.
  const variableNames = Object.keys(option.variables).map((variableName) => styleValue(variableName))
  return `${styleLabel(`${option.name}:`)} ${variableNames.join(", ")}`
}

/** Formats the options line, like `options: env: URL, PORT, secretEnv: TOKEN`. */
export const formatOptionsLine = (options: StepOptionDetail[]): string => {
  const optionsLineParts = options.map((option) => formatOptionsLinePart(option))
  return `${styleNote("options:")} ${optionsLineParts.join(", ")}`
}
