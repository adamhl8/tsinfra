import prettyBytes from "pretty-bytes"

import type { Bytes } from "#core/content/bytes.ts"
import type { FileComparisonValues } from "#core/session/handlers/file/comparison.ts"
import type { ContentComparison, SizeComparison } from "#core/session/handlers/file/comparison/content.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAttributeChange } from "#report/format/details/shared/attributes.ts"
import { changeDescriptionElement } from "#report/format/elements/asides.ts"
import { changeElement, wantValueElement } from "#report/format/elements/values.ts"

// Spell out a size in bytes, because a lone `B` reads like "billion".
const BYTE_UNIT = / B$/v

/** Formats a size like `15 bytes`, `1 byte`, or `2.05 kB`. */
const formatSize = (size: Bytes): string => prettyBytes(size).replace(BYTE_UNIT, size === 1 ? " byte" : " bytes")

// Give each kind of size comparison its words. The sizes follow every one, so they all read the same way.
const SIZE_COMPARISON_WORDS: Record<SizeComparison["kind"], string> = {
  new: "new file",
  hidden: "hidden",
  binary: "binary",
  large: "too large to diff",
}

/** Reports whether a file's content compared only by size, which shows as a note in place of a diff. */
const isSizeComparison = (content: ContentComparison): content is SizeComparison =>
  content.kind !== "same" && content.kind !== "text"

/** Formats a note in place of a diff, like `binary, 12 kB -> 14 kB`, or `new file, 2 kB` when there's no file yet. */
const formatSizeComparison = (sizeComparison: SizeComparison): string => {
  const { kind, gotSize, wantSize } = sizeComparison
  // Show the sizes as a change, because they're what changed, like an attribute's values.
  const wantText = wantValueElement(formatSize(wantSize))
  const sizes = gotSize === undefined ? wantText : changeElement(formatSize(gotSize), formatSize(wantSize))
  return `${changeDescriptionElement(SIZE_COMPARISON_WORDS[kind])}, ${sizes}`
}

/** Formats how a file differs as its rows: a note for content the output can't diff, then each attribute that changes. */
export const formatFileValues = (values: FileComparisonValues): AlignedRow[] => {
  const { content, attributeChanges } = values
  // Show a note for content the output can't diff, because a text diff prints as its own detail.
  const contentRows = isSizeComparison(content) ? [formatAlignedRow("content", [formatSizeComparison(content)])] : []
  const attributeRows = attributeChanges.map((attributeChange) => formatAttributeChange(attributeChange))
  return [...contentRows, ...attributeRows]
}
