import type { AlignedRow } from "#report/format/format.ts"
import type { OwnerChange } from "#session/session.ts"
import { styleGot, styleWant } from "#styles.ts"

/** Returns a row for an owner that changes, like `user alice -> bob`. */
export const toOwnerRow = (ownerChange: OwnerChange): AlignedRow => {
  const { name, got, want } = ownerChange
  return { label: name, valueLines: [`${styleGot(String(got))} -> ${styleWant(String(want))}`] }
}
