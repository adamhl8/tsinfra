import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { changeElement } from "#report/format/elements/elements.ts"
import type { ModeBits, OwnerChange } from "#session/session.ts"
import { toOctalMode, toSymbolicMode } from "#session/session.ts"

/** Formats mode bits as both notations, like `rw-r--r-- (644)`, because a script can write either one. */
export const formatMode = (bits: ModeBits) => `${toSymbolicMode(bits)} (${toOctalMode(bits)})`

/** Formats an owner that changes as its row, like `user: alice -> bob`. */
export const formatOwnerChange = (ownerChange: OwnerChange): AlignedRow => {
  const { name, got, want } = ownerChange
  return formatAlignedRow(name, [changeElement(got, want)])
}
