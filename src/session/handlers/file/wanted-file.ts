import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { FileContent, FileOptions } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"

/** What the script wants the file to be, worked out once before reading the state. */
export interface WantedFile extends Pick<FileOptions, "mode" | "user" | "group"> {
  bytes: Uint8Array
  size: Bytes
  hash: string
}

const readContent = async (content: FileContent): Promise<Result<Uint8Array>> => {
  // Wrap a string or bytes in a `Blob`, so all content has one read path.
  const blob = content instanceof Blob ? content : new Blob([content])

  const bytes = await attempt(async () => blob.bytes())
  if (!isErr(bytes)) return bytes

  // Check the value of `name`, because Bun answers `"name" in blob` with true for every `Blob`.
  const name = "name" in blob ? blob.name : undefined
  if (typeof name === "string") return err(`failed to read local file '${name}'`, bytes)

  return err("failed to read the content given to 'file'", bytes)
}

/** Reads the content, then works out its bytes, hash, and size, and the attributes the script manages. */
export const toWantedFile = async (content: FileContent, options: FileOptions): Promise<Result<WantedFile>> => {
  const { mode, user, group } = options

  const bytes = await readContent(content)
  if (isErr(bytes)) return bytes

  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  return {
    bytes,
    size: toBytes(bytes.length),
    hash,
    ...(mode === undefined ? {} : { mode }),
    ...(user === undefined ? {} : { user }),
    ...(group === undefined ? {} : { group }),
  }
}
