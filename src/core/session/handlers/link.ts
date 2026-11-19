import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareLink } from "#core/session/handlers/link/comparison.ts"
import { getHostLinkDetails } from "#core/session/handlers/link/host-link-details.ts"
import { writeLink } from "#core/session/handlers/link/write.ts"
import type { FileAttributeOptions, OwnerOptions } from "#core/session/handlers/options/attributes.ts"
import { fileAttributeOptionsSchema, ownerOptionsSchema } from "#core/session/handlers/options/attributes.ts"
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

export interface LinkOptions extends OwnerOptions, SudoOptions, NeedsOptions {
  /** Replaces a regular file or an empty directory at the path. A directory with files in it is an error. */
  force?: boolean
  /**
   * The mode and owner of the file the link points to, following any links in between. `user` and `group` stay the
   * link's own. A missing target is skipped, and the target keeps its own value of any left out.
   */
  targetAttributes?: FileAttributeOptions
}

// Write the reason here, because a relative target is a different mistake from a relative path.
const INVALID_TARGET_REASON =
  "must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory"

// Default to no attributes, which leaves the target alone.
const NO_TARGET_ATTRIBUTES: FileAttributeOptions = {}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const linkOptionsSchema = type
  .declare<HandlerOptions<LinkOptions>>()
  .type(
    ownerOptionsSchema
      .merge(needsOptionsSchema)
      .merge({ "force?": "boolean", "targetAttributes?": fileAttributeOptionsSchema }),
  )
  .pipe((options) => ({ force: false, targetAttributes: NO_TARGET_ATTRIBUTES, needs: NO_NEEDS, ...options }))

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

  const { needs, force, targetAttributes } = validOptions
  recordOptions({ force })

  // Claim the target's attributes before `converge`, so a conflict fails in `plan` too, even for a step that waits.
  const targetAttributeClaimResult = claimPathAttributes(ctx, absoluteTarget, targetAttributes)
  if (isErr(targetAttributeClaimResult)) return targetAttributeClaimResult

  const status = await converge(ctx, {
    needs,
    getHostDetails: async () => getHostLinkDetails(shell, absolutePath, absoluteTarget),
    compare: async (hostLinkDetails) => compareLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    fix: async (hostLinkDetails) => writeLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
