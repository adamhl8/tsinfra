import type { AttributeChange } from "#core/session/handlers/shared/filesystem/attributes.ts"
import type { ModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { toOctalMode, toSymbolicMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { changeElement } from "#report/format/elements/values.ts"

/** Formats mode bits as both notations, like `rw-r--r-- (644)`, because a script can write either one. */
export const formatMode = (bits: ModeBits) => `${toSymbolicMode(bits)} (${toOctalMode(bits)})`

/**
 * Formats an attribute that changes as its row, like `user: alice -> bob`, with a mode in both notations. A `prefix`
 * says which file it belongs to, like `target mode:`.
 */
export const formatAttributeChange = (attributeChange: AttributeChange, prefix?: string): AlignedRow => {
  const { name, got, want } = attributeChange

  const label = prefix === undefined ? name : `${prefix} ${name}`
  if (name === "mode") return formatAlignedRow(label, [changeElement(formatMode(got), formatMode(want))])

  return formatAlignedRow(label, [changeElement(got, want)])
}
