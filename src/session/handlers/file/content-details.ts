import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { FileContent } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"

/** What the script's content is, worked out once before reading the host's state. */
export interface FileContentDetails {
  bytes: Uint8Array
  size: Bytes
  hash: string
}

const getContentBytes = async (content: FileContent): Promise<Result<Uint8Array>> => {
  // Wrap a string or bytes in a `Blob`, so all content has one read path.
  const blob = content instanceof Blob ? content : new Blob([content])

  // Check the value of `name`, because Bun answers `"name" in blob` with true for every `Blob`.
  const name = "name" in blob ? blob.name : undefined
  const source = typeof name === "string" ? `local file '${name}'` : "the content given to 'file'"

  const bytes = await attempt(async () => blob.bytes())
  return isErr(bytes) ? err(`failed to read ${source}`, bytes) : bytes
}

/** Gets the content's bytes, which reads a `Blob` like `Bun.file(...)`, and works out their size and hash. */
export const getContentDetails = async (content: FileContent): Promise<Result<FileContentDetails>> => {
  const bytes = await getContentBytes(content)
  if (isErr(bytes)) return bytes

  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  return { bytes, size: toBytes(bytes.length), hash }
}
