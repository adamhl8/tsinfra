import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HandlerContext } from "#core/session/context.ts"
import type { ValidLinkOptions } from "#core/session/handlers/link.ts"
import type { HostLinkDetails } from "#core/session/handlers/link/host-link-details.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { AttributeChange, OwnerChange } from "#core/session/handlers/shared/filesystem/attributes.ts"
import { findAttributeChanges } from "#core/session/handlers/shared/filesystem/attributes.ts"
import { checkCanSetOwner, findOwnerChanges } from "#core/session/handlers/shared/filesystem/attributes/owner.ts"

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
export interface LinkComparisonValues extends LinkChanges {
  kind: "link"
  /** The target the script wants, so the report can name it even when the link is already right. */
  target: string
  targetExists: boolean
}

/** What differs about the link itself, and about the file at the end of its target. */
interface LinkChanges {
  linkChange: LinkChange
  ownerChanges: OwnerChange[]
  /** Empty when the step sets no `targetAttributes`, or the target is missing. */
  targetAttributeChanges: AttributeChange[]
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

/** Finds what differs about the link and its target. The write works it out again from the details the fix gets. */
export const findLinkChanges = (
  hostLinkDetails: HostLinkDetails,
  target: string,
  options: ValidLinkOptions,
): LinkChanges => {
  const { targetAttributes } = hostLinkDetails
  const { targetAttributes: targetAttributeOptions } = options

  const currentOwner = hostLinkDetails.kind === "new" ? undefined : hostLinkDetails.owner
  const linkChange = toLinkChange(hostLinkDetails, target)
  const ownerChanges = currentOwner === undefined ? [] : findOwnerChanges(currentOwner, options)

  const targetAttributeChanges =
    targetAttributes === undefined ? [] : findAttributeChanges(targetAttributes, targetAttributeOptions)

  return { linkChange, ownerChanges, targetAttributeChanges }
}

/** Reports whether the link itself is right, whatever its target needs. */
export const isLinkItselfInSync = (linkChanges: LinkChanges): boolean => {
  const { linkChange, ownerChanges } = linkChanges
  return linkChange.kind === "same" && ownerChanges.length === 0
}

/** Compares what's at the link's path on the host with what the script wants, and fails a write that can't work. */
export const compareLink = async (
  ctx: HandlerContext,
  hostLinkDetails: HostLinkDetails,
  target: string,
  options: ValidLinkOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx.step
  const { kind: linkDetailsKind, path, targetAttributes } = hostLinkDetails
  const { force, targetAttributes: targetAttributeOptions } = options

  if (linkDetailsKind === "file" && !force)
    return err(`'${path}' is a regular file, so link won't replace it without force: true`, undefined)
  if (linkDetailsKind === "emptyDirectory" && !force)
    return err(`'${path}' is an empty directory, so link won't replace it without force: true`, undefined)

  const linkChanges = findLinkChanges(hostLinkDetails, target, options)
  const isLinkInSync = isLinkItselfInSync(linkChanges)
  const isTargetInSync = linkChanges.targetAttributeChanges.length === 0

  const inSync = isLinkInSync && isTargetInSync
  const targetExists = targetAttributes !== undefined
  const comparison: Comparison = { inSync, values: { kind: "link", ...linkChanges, target, targetExists } }

  // Check only what the write touches, because it leaves the link or the target alone when that part is in sync.
  if (!isLinkInSync) {
    const currentOwner = hostLinkDetails.kind === "new" ? undefined : hostLinkDetails.owner
    const ownerCheck = await checkCanSetOwner(shell, path, currentOwner, options)
    if (isErr(ownerCheck)) return ownerCheck
  }

  if (!isTargetInSync) {
    const targetOwnerCheck = await checkCanSetOwner(shell, target, targetAttributes, targetAttributeOptions)
    if (isErr(targetOwnerCheck)) return targetOwnerCheck
  }

  return comparison
}
