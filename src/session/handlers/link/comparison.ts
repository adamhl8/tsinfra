import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostLinkDetails } from "#session/handlers/link/host-link-details.ts"
import type { ValidLinkOptions } from "#session/handlers/link/link.ts"
import type { Comparison, OwnerChange } from "#session/handlers/shared/shared.ts"
import { checkCanSetOwner, findOwnerChanges } from "#session/handlers/shared/shared.ts"
import type { StepContext } from "#session/step.ts"

/**
 * How the path becomes a link to the wanted target: a new link, one that replaces something, or one that changes its
 * target.
 */
export type LinkChange =
  | { kind: "same" }
  | { kind: "new"; want: string }
  | { kind: "replacesFile"; want: string }
  | { kind: "replacesEmptyDirectory"; want: string }
  | { kind: "changed"; got: string; want: string }

/** How a link on the host differs from what the script wants, and whether its target exists. */
export interface LinkComparisonValues {
  kind: "link"
  linkChange: LinkChange
  ownerChanges: OwnerChange[]
  /** The target the script wants, so the report can name it even when the link is already right. */
  target: string
  targetExists: boolean
}

const toLinkChange = (hostLinkDetails: HostLinkDetails, target: string): LinkChange => {
  if (hostLinkDetails.kind === "link") {
    const { currentTarget } = hostLinkDetails
    return currentTarget === target ? { kind: "same" } : { kind: "changed", got: currentTarget, want: target }
  }

  if (hostLinkDetails.kind === "new") return { kind: "new", want: target }
  if (hostLinkDetails.kind === "file") return { kind: "replacesFile", want: target }
  return { kind: "replacesEmptyDirectory", want: target }
}

/** Compares what's at the link's path on the host with what the script wants, and fails a write that can't work. */
export const compareLink = async (
  ctx: StepContext,
  hostLinkDetails: HostLinkDetails,
  target: string,
  options: ValidLinkOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx
  const { kind: linkDetailsKind, path, targetExists } = hostLinkDetails
  const { force } = options

  if (linkDetailsKind === "file" && !force)
    return err(`'${path}' is a regular file, so link won't replace it without force: true`, undefined)
  if (linkDetailsKind === "emptyDirectory" && !force)
    return err(`'${path}' is an empty directory, so link won't replace it without force: true`, undefined)

  const currentOwner = hostLinkDetails.kind === "new" ? undefined : hostLinkDetails.owner
  const ownerChanges = currentOwner === undefined ? [] : findOwnerChanges(currentOwner, options)

  const linkChange = toLinkChange(hostLinkDetails, target)

  const inSync = linkChange.kind === "same" && ownerChanges.length === 0
  const comparison: Comparison = { inSync, values: { kind: "link", linkChange, ownerChanges, target, targetExists } }

  // Skip the owner check for a link in sync, because no write is coming.
  if (inSync) return comparison

  const ownerCheck = await checkCanSetOwner(shell, path, currentOwner, options)
  return isErr(ownerCheck) ? ownerCheck : comparison
}
