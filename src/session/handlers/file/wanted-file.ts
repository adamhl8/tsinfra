import type { FileOptions } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import type { FileMode } from "#session/handlers/file/mode.ts"

/** What the script wants the file to be, worked out once before reading the state. */
export interface WantedFile {
  bytes: Uint8Array
  size: Bytes
  hash: string
  mode?: FileMode
  owner?: string | number
  group?: string | number
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
