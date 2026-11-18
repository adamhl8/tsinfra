import { type } from "arktype"
import prettyBytes from "pretty-bytes"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import { toBytes } from "#core/session/handlers/shared/filesystem/bytes.ts"

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

// Limit the content, because the shell holds the whole script in memory, and base64 adds a third.
const MAX_CONTENT_BYTES = toBytes(10_000_000) // 10 MB
const MAX_CONTENT_TEXT = prettyBytes(MAX_CONTENT_BYTES)

/**
 * Reads the content's bytes, which reads a `Blob` like `bun.file(...)`, and refuses content over the limit. An error
 * names a `Blob` with a name as its local file, and any other content as `contentLabel`.
 */
export const readContentBytes = async (content: Content, contentLabel: string): Promise<Result<Uint8Array>> => {
  // Wrap a string or bytes in a `Blob`, so all content has one read path.
  const blob = content instanceof Blob ? content : new Blob([content])

  // Check the value of `name`, because Bun answers `"name" in blob` with true for every `Blob`.
  const name = "name" in blob ? blob.name : undefined
  const source = typeof name === "string" ? `local file '${name}'` : contentLabel

  const { size } = blob
  // Check for `Infinity` first, because `bun.file` gives it for a device, and `prettyBytes` throws on it.
  if (size === Number.POSITIVE_INFINITY) {
    return err(
      `${source} doesn't have a size (is it a file?), so it can't be checked against the ${MAX_CONTENT_TEXT} limit`,
      undefined,
    )
  }
  if (size > MAX_CONTENT_BYTES)
    return err(`${source} is ${prettyBytes(size)}, above the ${MAX_CONTENT_TEXT} limit`, undefined)

  const bytes = await attempt(async () => blob.bytes())
  return isErr(bytes) ? err(`failed to read ${source}`, bytes) : bytes
}
