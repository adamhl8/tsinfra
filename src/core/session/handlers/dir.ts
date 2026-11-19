import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareDir } from "#core/session/handlers/dir/comparison.ts"
import { getHostDirDetails } from "#core/session/handlers/dir/host-dir-details.ts"
import { writeDir } from "#core/session/handlers/dir/write.ts"
import type { FileAttributeOptions } from "#core/session/handlers/options/attributes.ts"
import { fileAttributeOptionsSchema } from "#core/session/handlers/options/attributes.ts"
import type { SudoOptions } from "#core/session/handlers/options/command.ts"
import type { HandlerOptions, NeedsOptions } from "#core/session/handlers/options/step.ts"
import { needsOptionsSchema, NO_NEEDS } from "#core/session/handlers/options/step.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { converge } from "#core/session/handlers/shared/converge.ts"
import { claimPathAttributes } from "#core/session/handlers/shared/filesystem/attributes/claims.ts"
import { validateHostPath } from "#core/session/handlers/shared/filesystem/path.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

export interface DirOptions extends FileAttributeOptions, SudoOptions, NeedsOptions {}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const dirOptionsSchema = type
  .declare<HandlerOptions<DirOptions>>()
  .type(fileAttributeOptionsSchema.merge(needsOptionsSchema))
  .pipe((options) => ({ needs: NO_NEEDS, ...options }))

/** The options after validation, with their defaults set. */
export type ValidDirOptions = typeof dirOptionsSchema.infer

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

  const { needs } = validOptions

  // Claim the directory's attributes before `converge`, so a conflict fails in `plan` too, even for a step that waits.
  const attributeClaimResult = claimPathAttributes(ctx, absolutePath, validOptions)
  if (isErr(attributeClaimResult)) return attributeClaimResult

  const status = await converge(ctx, {
    needs,
    getHostDetails: async () => getHostDirDetails(shell, absolutePath),
    compare: async (hostDirDetails) => compareDir(ctx, hostDirDetails, validOptions),
    fix: async (hostDirDetails) => writeDir(ctx, hostDirDetails, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
