import type { FileOptions } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"

/** What the script wants the file to be, worked out once before reading the state. */
export interface WantedFile extends Pick<FileOptions, "mode" | "owner" | "group"> {
  bytes: Uint8Array
  size: Bytes
  hash: string
}

/** Works out the bytes, hash, and size of the content, and the attributes the script manages. */
export const toWantedFile = (options: FileOptions): WantedFile => {
  const { content, mode, owner, group } = options
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  return {
    bytes,
    size: toBytes(bytes.length),
    hash,
    ...(mode === undefined ? {} : { mode }),
    ...(owner === undefined ? {} : { owner }),
    ...(group === undefined ? {} : { group }),
  }
}
