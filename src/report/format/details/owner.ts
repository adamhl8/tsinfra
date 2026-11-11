import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import type { OwnerChange } from "#session/session.ts"
import { styleGot, styleWant } from "#styles.ts"

/** Formats an owner that changes as its row, like `user: alice -> bob`. */
export const formatOwnerChange = (ownerChange: OwnerChange): AlignedRow => {
  const { name, got, want } = ownerChange
  return formatAlignedRow(name, [`${styleGot(String(got))} -> ${styleWant(String(want))}`])
}
