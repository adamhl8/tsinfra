import { type } from "arktype"

/** Data from the control machine: a string or bytes computed there, or a `Blob` like `bun.file(...)` for a file there. */
export type Content = string | Uint8Array | Blob

// Widen `Uint8Array` with `as`, because ArkType infers `Uint8Array<ArrayBuffer>` and `Content` takes any buffer.
export const contentSchema = type
  .declare<Content>()
  .type(type("string").or(type.instanceOf(Uint8Array).as<Uint8Array>()).or(type.instanceOf(Blob)))

/** What content can be, as an error message names it. */
export const CONTENT_DESCRIPTION = "a string, bytes, or a Blob"

// Write the reason here, because ArkType's summary names different types depending on the value.
export const INVALID_CONTENT_REASON = `must be ${CONTENT_DESCRIPTION}`
