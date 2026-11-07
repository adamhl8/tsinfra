import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { ValidateFunction } from "#session/handlers/file.ts"
import { TEMP_PATH_ARG } from "#session/handlers/shared/filesystem/write-script.ts"
import { validateInput } from "#session/handlers/shared/validate-input.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

/**
 * Builds the command that checks the new content, by calling the script's `validate` with the temp file's path. It runs
 * in `plan` too, so a bad command shows before anything is written.
 */
export const buildValidateCommand = (validate: ValidateFunction | undefined): Result<string | undefined> => {
  if (validate === undefined) return undefined

  // Treat what `validate` returns as unknown, because a script can get past the types and return anything.
  const command: unknown = attempt(() => validate(TEMP_PATH_ARG))
  if (isErr(command)) return err("failed to call the validate function given to 'file'", command)

  return validateInput(command, nonEmptyStringSchema, { inputLabel: "validate command", givenTo: "file" })
}
