import type { Type } from "arktype"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { ToolName } from "#session/handlers/tools.ts"
import type { StepKind } from "#session/step.ts"

export interface InputDescription {
  /** What the input is to the script, like `options` or `command`. */
  inputLabel: string
  /** Who the script gave the input to. A step's error shows under its name, so this only needs the kind. */
  givenTo: StepKind | ToolName
  /** Replaces the summary ArkType writes. */
  reason?: string
}

/** Validates what the script gave a step or a tool against `schema`, and describes a value that doesn't match. */
export const validateInput = <S extends Type>(
  value: unknown,
  schema: S,
  description: InputDescription,
): Result<S["infer"]> => {
  const { inputLabel, givenTo, reason } = description

  const valid: unknown = schema(value)
  if (valid instanceof type.errors)
    return err(`failed to validate the ${inputLabel} given to '${givenTo}'`, err(reason ?? valid.summary, undefined))

  return valid
}
