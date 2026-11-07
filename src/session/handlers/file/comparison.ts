import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import { findAttributeChanges } from "#session/handlers/file/comparison/attributes.ts"
import type { ContentComparison } from "#session/handlers/file/comparison/content.ts"
import { compareContent } from "#session/handlers/file/comparison/content.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
import type { Comparison } from "#session/handlers/shared/converge.ts"
import type { AttributeChange } from "#session/handlers/shared/filesystem/attributes.ts"
import { checkCanSetOwner } from "#session/handlers/shared/filesystem/owner.ts"
import type { StepContext } from "#session/step.ts"

/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparisonValues {
  kind: "file"
  content: ContentComparison
  attributeChanges: AttributeChange[]
}

/** Compares the file's details on the host with what the script wants, and fails a write that can't work. */
export const compareFile = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx
  const { path } = hostFileDetails

  const content = await compareContent(shell, hostFileDetails, resolvedContent, options)
  if (isErr(content)) return content

  const attributes = hostFileDetails.kind === "new" ? undefined : hostFileDetails.attributes
  const attributeChanges = attributes === undefined ? [] : findAttributeChanges(attributes, options)

  const inSync = content.kind === "same" && attributeChanges.length === 0
  const comparison: Comparison = { inSync, values: { kind: "file", content, attributeChanges } }

  // Skip the owner check for a file in sync, because no write is coming.
  if (inSync) return comparison

  const ownerCheck = await checkCanSetOwner(shell, path, attributes, options)
  return isErr(ownerCheck) ? ownerCheck : comparison
}
