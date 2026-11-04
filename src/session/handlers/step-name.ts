import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { StepKind } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

// Name what each step takes as its name, so a validation error says which argument is wrong.
const STEP_NAME_LABELS: Record<StepKind, string> = {
  read: "command",
  inspect: "command",
  file: "path",
  ensure: "name",
  run: "name",
}

/** Validates the name a step is called with, which is its command for `read` and `inspect` and its path for `file`. */
export const validateStepName = (stepName: unknown, kind: StepKind): Result<string> => {
  const validName = nonEmptyStringSchema(stepName)
  if (validName instanceof type.errors)
    return err(`failed to validate the ${STEP_NAME_LABELS[kind]} given to '${kind}'`, err(validName.summary, undefined))

  return validName
}
