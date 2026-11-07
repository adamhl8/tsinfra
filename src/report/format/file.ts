import prettyBytes from "pretty-bytes"

import type { AlignedRow } from "#report/format.ts"
import { toOwnerRow } from "#report/format/owner.ts"
import { styleDescription, styleGot, styleWant } from "#report/format/styles.ts"
import type { FileComparisonValues } from "#session/handlers/file/comparison.ts"
import type { ContentComparison, SizeComparison } from "#session/handlers/file/comparison/content.ts"
import type { AttributeChange } from "#session/handlers/shared/filesystem/attributes.ts"
import type { Bytes } from "#session/handlers/shared/filesystem/bytes.ts"
import type { ModeBits } from "#session/handlers/shared/filesystem/mode.ts"
import { toOctalMode, toSymbolicMode } from "#session/handlers/shared/filesystem/mode.ts"

// Spell out a size in bytes, because a lone `B` reads like "billion".
const BYTE_UNIT = / B$/v

/** Formats a size like `15 bytes`, `1 byte`, or `2.05 kB`. */
const formatSize = (size: Bytes): string => prettyBytes(size).replace(BYTE_UNIT, size === 1 ? " byte" : " bytes")

// Give each note its words. The sizes follow every note, so they all read the same way.
const FILE_NOTE_WORDS: Record<SizeComparison["kind"], string> = {
  new: "new file",
  hidden: "hidden",
  binary: "binary",
  large: "too large to diff",
}

/** Reports whether a file's content compared only by size, which shows as a note in place of a diff. */
const isSizeComparison = (content: ContentComparison): content is SizeComparison =>
  content.kind !== "same" && content.kind !== "text"

/** Formats a note in place of a diff, like `binary, 12 kB -> 14 kB`, or `new file, 2 kB` when there's no file yet. */
const formatFileNote = (sizeComparison: SizeComparison): string => {
  const { kind, gotSize, wantSize } = sizeComparison
  // Color the sizes like `got` and `want`, because they're the change, like an attribute's values.
  const wantText = styleWant(formatSize(wantSize))
  const sizes = gotSize === undefined ? wantText : `${styleGot(formatSize(gotSize))} -> ${wantText}`
  return `${styleDescription(FILE_NOTE_WORDS[kind])}, ${sizes}`
}

/** Formats mode bits as both notations, like `rw-r--r-- (644)`, because a script can write either one. */
const formatMode = (bits: ModeBits) => `${toSymbolicMode(bits)} (${toOctalMode(bits)})`

const toAttributeRow = (attributeChange: AttributeChange): AlignedRow => {
  if (attributeChange.name !== "mode") return toOwnerRow(attributeChange)

  const { name, got, want } = attributeChange
  return { label: name, valueLines: [`${styleGot(formatMode(got))} -> ${styleWant(formatMode(want))}`] }
}

/** Returns a note row for content the output can't diff, then a row for each attribute that changes. */
export const toFileRows = (values: FileComparisonValues): AlignedRow[] => {
  const { content, attributeChanges } = values
  // Show a note for content the output can't diff, because a text diff prints as its own detail.
  const contentRows = isSizeComparison(content) ? [{ label: "content", valueLines: [formatFileNote(content)] }] : []
  return [...contentRows, ...attributeChanges.map((attributeChange) => toAttributeRow(attributeChange))]
}
