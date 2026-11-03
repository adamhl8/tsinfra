declare const BYTES_BRAND: unique symbol

/** A size in bytes. Only `toBytes` makes one, so a plain number can't stand in for a size. */
export type Bytes = number & { readonly [BYTES_BRAND]: true }
// oxlint-disable-next-line typescript/no-unsafe-type-assertion - a brand exists only in the types, so only `as` can make one
export const toBytes = (count: number): Bytes => count as Bytes
