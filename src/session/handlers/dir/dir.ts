import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { getHostDirDetails } from "#session/handlers/dir/host-dir-details.ts"
import { writeDir } from "#session/handlers/dir/write.ts"
import { compareRecords } from "#session/handlers/ensure/ensure.ts"
import type { ChangeStepResult } from "#session/handlers/shared/shared.ts"
import { converge, withChangeStepResult, validateHostPath, validateInput } from "#session/handlers/shared/shared.ts"
import type { HandlerOptions, NeedsOptions, SudoOptions } from "#session/handlers/step-options/step-options.ts"
import { NO_NEEDS, needsOptionsSchema } from "#session/handlers/step-options/step-options.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

export interface DirOptions extends SudoOptions, NeedsOptions {}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const dirOptionsSchema = type
  .declare<HandlerOptions<DirOptions>>()
  .type(needsOptionsSchema)
  .pipe((options) => ({ needs: NO_NEEDS, ...options }))

// Compare the directory as an object `want`, so the report shows its keys as an object `ensure`'s rows.
const DIR_WANT = { exists: true }

export const handleDir = async (
  ctx: StepContext<"dir">,
  path: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"dir">>>> => {
  const { kind, shell, home } = ctx

  const absolutePath = validateHostPath(path, home, { inputLabel: "path", givenTo: kind })
  if (isErr(absolutePath)) return absolutePath

  const validOptions = validateInput(options, dirOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const status = await converge(ctx, {
    needs: validOptions.needs,
    getHostDetails: async () => getHostDirDetails(shell, absolutePath),
    compare: (hostDirDetails) => compareRecords({ exists: hostDirDetails.kind === "directory" }, DIR_WANT),
    fix: async () => writeDir(shell, absolutePath),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
