import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { changeElement } from "#report/format/elements/elements.ts"
import type { OwnerChange } from "#session/session.ts"

/** Formats an owner that changes as its row, like `user: alice -> bob`. */
export const formatOwnerChange = (ownerChange: OwnerChange): AlignedRow => {
  const { name, got, want } = ownerChange
  return formatAlignedRow(name, [changeElement(got, want)])
}
