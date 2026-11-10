import { CryptoHasher } from "bun"
import prettyBytes from "pretty-bytes"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { FileContent } from "#session/handlers/file/file.ts"
import type { Bytes } from "#session/handlers/shared/shared.ts"
import { toBytes } from "#session/handlers/shared/shared.ts"

/** What the script's content is, worked out once before reading the host's state. */
export interface ResolvedFileContent {
  bytes: Uint8Array
  size: Bytes
  hash: string
}

// Limit the content, because the shell holds the whole script in memory, and base64 adds a third.
const MAX_CONTENT_BYTES = toBytes(10_000_000) // 10 MB
const MAX_CONTENT_TEXT = prettyBytes(MAX_CONTENT_BYTES)

const getContentBytes = async (content: FileContent): Promise<Result<Uint8Array>> => {
  // Wrap a string or bytes in a `Blob`, so all content has one read path.
  const blob = content instanceof Blob ? content : new Blob([content])

  // Check the value of `name`, because Bun answers `"name" in blob` with true for every `Blob`.
  const name = "name" in blob ? blob.name : undefined
  const source = typeof name === "string" ? `local file '${name}'` : "the content given to 'file'"

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

/** Gets the content's bytes, which reads a `Blob` like `bun.file(...)`, and works out their size and hash. */
export const resolveContent = async (content: FileContent): Promise<Result<ResolvedFileContent>> => {
  const bytes = await getContentBytes(content)
  if (isErr(bytes)) return bytes

  const hash = new CryptoHasher("sha256").update(bytes).digest("hex")
  return { bytes, size: toBytes(bytes.length), hash }
}
