import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { AttributeChange } from "#session/handlers/file/comparison/attributes.ts"
import { findAttributeChanges } from "#session/handlers/file/comparison/attributes.ts"
import type { ContentComparison } from "#session/handlers/file/comparison/content.ts"
import { compareContent } from "#session/handlers/file/comparison/content.ts"
import { checkWriteOwner } from "#session/handlers/file/comparison/owner.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
import type { Comparison } from "#session/handlers/shared/converge.ts"
import type { StepContext } from "#session/step.ts"

/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparisonValues {
  kind: "file"
  content: ContentComparison
  attributes: AttributeChange[]
}

const compareDetails = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx

  if (hostFileDetails.kind === "new") {
    const content: ContentComparison = { kind: "new", wantSize: resolvedContent.size }
    return { inSync: false, values: { kind: "file", content, attributes: [] } }
  }

  const content = await compareContent(shell, hostFileDetails, resolvedContent, options)
  if (isErr(content)) return content

  const attributes = findAttributeChanges(hostFileDetails.attributes, options)

  const inSync = content.kind === "same" && attributes.length === 0

  return { inSync, values: { kind: "file", content, attributes } }
}

/** Compares the file's details on the host with what the script wants, and fails a write that can't work. */
export const compareFile = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result<Comparison>> => {
  const comparison = await compareDetails(ctx, hostFileDetails, resolvedContent, options)
  if (isErr(comparison)) return comparison

  // Skip the owner check for a file in sync, because no write is coming.
  if (comparison.inSync) return comparison

  const ownerCheck = await checkWriteOwner(ctx, hostFileDetails, options)
  return isErr(ownerCheck) ? ownerCheck : comparison
}
