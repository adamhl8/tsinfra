/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparison {
  kind: "file"
  content: FileContent
  attributes: AttributeChange[]
}

/** How a managed file's content differs. `text` holds both sides for a diff, and a `FileNote` stands in for one. */
export type FileContent = { kind: "same" } | { kind: "text"; got: string; want: string } | FileNote

/** Why the output shows a note in place of a diff, with the sizes. `gotSize` is unset for a new file. */
export interface FileNote {
  kind: "new" | "hidden" | "binary" | "large"
  gotSize?: Bytes
  wantSize: Bytes
}

/** Reports whether a file's content is a note in place of a diff. */
export const isFileNote = (content: FileContent): content is FileNote =>
  content.kind !== "same" && content.kind !== "text"

/** A managed attribute of a file whose value differs, as the output shows it. */
export interface AttributeChange {
  name: "mode" | "owner" | "group"
  got: string
  want: string
}

declare const BYTES_BRAND: unique symbol

/** A size in bytes. Only `toBytes` makes one, so a plain number can't stand in for a size. */
export type Bytes = number & { readonly [BYTES_BRAND]: true }
// oxlint-disable-next-line typescript/no-unsafe-type-assertion - a brand exists only in the types, so only `as` can make one
export const toBytes = (count: number) => count as Bytes
