import type { LabelRow } from "#report/format.ts"
import { styleGot, styleWant } from "#report/format/styles.ts"
import type { OwnerChange } from "#session/handlers/shared/filesystem/attributes.ts"

/** Returns a row for an owner that changes, like `user alice -> bob`. */
export const toOwnerRow = (ownerChange: OwnerChange): LabelRow => {
  const { name, got, want } = ownerChange
  return { label: name, valueLines: [`${styleGot(String(got))} -> ${styleWant(String(want))}`] }
}
