import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { AttributeChange } from "#session/handlers/file/comparison/attributes.ts"
import { findAttributeChanges } from "#session/handlers/file/comparison/attributes.ts"
import type { ContentComparison } from "#session/handlers/file/comparison/content.ts"
import { compareContent } from "#session/handlers/file/comparison/content.ts"
import { getHostFileDetails } from "#session/handlers/file/comparison/host-file-details.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
import type { Comparison } from "#session/handlers/shared/converge.ts"
import type { StepContext } from "#session/step.ts"

/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparisonValues {
  kind: "file"
  content: ContentComparison
  attributes: AttributeChange[]
}

/** Reads the file's details on the host and compares them with what the script wants. */
// oxlint-disable-next-line eslint/max-params - this matches the shape of `handleFile`
export const compareFile = async (
  ctx: StepContext,
  path: string,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx

  const hostFileDetails = await getHostFileDetails(shell, path)
  if (isErr(hostFileDetails)) return hostFileDetails

  if (hostFileDetails === undefined) {
    const content: ContentComparison = { kind: "new", wantSize: resolvedContent.size }
    return { inSync: false, values: { kind: "file", content, attributes: [] } }
  }

  const { content: hostContentDetails, attributes: hostAttributeDetails } = hostFileDetails

  const content = await compareContent(shell, hostContentDetails, resolvedContent, options)
  if (isErr(content)) return content

  const attributes = findAttributeChanges(hostAttributeDetails, options)

  const inSync = content.kind === "same" && attributes.length === 0

  return { inSync, values: { kind: "file", content, attributes } }
}
