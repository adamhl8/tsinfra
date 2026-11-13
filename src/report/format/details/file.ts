import prettyBytes from "pretty-bytes"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { formatOwnerChange } from "#report/format/details/owner.ts"
import { formatChange, formatChangeDescription, formatWantValue } from "#report/format/elements/elements.ts"
import type {
  FileComparisonValues,
  ContentComparison,
  SizeComparison,
  AttributeChange,
  Bytes,
  ModeBits,
} from "#session/session.ts"
import { toOctalMode, toSymbolicMode } from "#session/session.ts"

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
  const wantText = formatWantValue(formatSize(wantSize))
  const sizes = gotSize === undefined ? wantText : formatChange(formatSize(gotSize), formatSize(wantSize))
  return `${formatChangeDescription(SIZE_COMPARISON_WORDS[kind])}, ${sizes}`
}

/** Formats mode bits as both notations, like `rw-r--r-- (644)`, because a script can write either one. */
const formatMode = (bits: ModeBits) => `${toSymbolicMode(bits)} (${toOctalMode(bits)})`

const formatAttributeChange = (attributeChange: AttributeChange): AlignedRow => {
  if (attributeChange.name !== "mode") return formatOwnerChange(attributeChange)

  const { name, got, want } = attributeChange
  return formatAlignedRow(name, [formatChange(formatMode(got), formatMode(want))])
}

/** Formats how a file differs as its rows: a note for content the output can't diff, then each attribute that changes. */
export const formatFileValues = (values: FileComparisonValues): AlignedRow[] => {
  const { content, attributeChanges } = values
  // Show a note for content the output can't diff, because a text diff prints as its own detail.
  const contentRows = isSizeComparison(content) ? [formatAlignedRow("content", [formatSizeComparison(content)])] : []
  const attributeRows = attributeChanges.map((attributeChange) => formatAttributeChange(attributeChange))
  return [...contentRows, ...attributeRows]
}
