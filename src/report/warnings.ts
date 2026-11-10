import type { StepRecord } from "#session/session.ts"

/** Something that worked but needs a look, with the value it's about, like a path, when there is one. */
export interface StepWarning {
  text: string
  value?: string
}

// Point the words at the target, which follows them in the value color.
const MISSING_TARGET_TEXT = "nothing exists at target ->"

/**
 * Returns what a step should warn about, from its latest comparison, so `apply` warns about the state it left. A failed
 * step gets none, because its error is what needs fixing first.
 */
export const getStepWarnings = (stepRecord: StepRecord): StepWarning[] => {
  const { status, comparisons } = stepRecord
  if (status === undefined) return []

  const values = (comparisons.after ?? comparisons.before)?.values
  if (values?.kind === "link" && !values.targetExists) return [{ text: MISSING_TARGET_TEXT, value: values.target }]

  return []
}
