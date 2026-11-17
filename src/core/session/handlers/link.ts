import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareLink } from "#core/session/handlers/link/comparison.ts"
import { getHostLinkDetails } from "#core/session/handlers/link/host-link-details.ts"
import { writeLink } from "#core/session/handlers/link/write.ts"
import type { OwnerOptions, NeedsOptions } from "#core/session/handlers/options/handler.ts"
import { ownerOptionsSchema, NO_NEEDS, needsOptionsSchema } from "#core/session/handlers/options/handler.ts"
import type { HandlerOptions, SudoOptions } from "#core/session/handlers/options/shell.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { converge } from "#core/session/handlers/shared/converge.ts"
import { validateHostPath } from "#core/session/handlers/shared/filesystem/path.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

export interface LinkOptions extends OwnerOptions, SudoOptions, NeedsOptions {
  /** Replaces a regular file or an empty directory at the path. A directory with files in it is an error. */
  force?: boolean
}

// Write the reason here, because a relative target is a different mistake from a relative path.
const INVALID_TARGET_REASON =
  "must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory"

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const linkOptionsSchema = type
  .declare<HandlerOptions<LinkOptions>>()
  .type(ownerOptionsSchema.merge(needsOptionsSchema).merge({ "force?": "boolean" }))
  .pipe((options) => ({ force: false, needs: NO_NEEDS, ...options }))

/** The options after validation, with their defaults set. */
export type ValidLinkOptions = typeof linkOptionsSchema.infer

export const handleLink = async (
  ctx: StepContext<"link">,
  path: unknown,
  target: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"link">>>> => {
  const { kind, shell, home, recordOptions } = ctx

  const absolutePath = validateHostPath(path, home, { inputLabel: "path", givenTo: kind })
  if (isErr(absolutePath)) return absolutePath

  const absoluteTarget = validateHostPath(target, home, {
    inputLabel: "target",
    givenTo: kind,
    reason: INVALID_TARGET_REASON,
  })
  if (isErr(absoluteTarget)) return absoluteTarget

  const validOptions = validateInput(options, linkOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { needs, force } = validOptions
  recordOptions({ force })

  const status = await converge(ctx, {
    needs,
    getHostDetails: async () => getHostLinkDetails(shell, absolutePath, absoluteTarget),
    compare: async (hostLinkDetails) => compareLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    fix: async (hostLinkDetails) => writeLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
