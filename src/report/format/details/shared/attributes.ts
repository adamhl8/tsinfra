import type { OwnerChange } from "#core/session/handlers/shared/filesystem/attributes.ts"
import type { ModeBits } from "#core/session/handlers/shared/filesystem/mode.ts"
import { toOctalMode, toSymbolicMode } from "#core/session/handlers/shared/filesystem/mode.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { changeElement } from "#report/format/elements/values.ts"

/** Formats mode bits as both notations, like `rw-r--r-- (644)`, because a script can write either one. */
export const formatMode = (bits: ModeBits) => `${toSymbolicMode(bits)} (${toOctalMode(bits)})`

/** Formats an owner that changes as its row, like `user: alice -> bob`. */
export const formatOwnerChange = (ownerChange: OwnerChange): AlignedRow => {
  const { name, got, want } = ownerChange
  return formatAlignedRow(name, [changeElement(got, want)])
}
