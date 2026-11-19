import { CryptoHasher } from "bun"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Bytes } from "#core/content/bytes.ts"
import { toBytes } from "#core/content/bytes.ts"
import { readContentBytes } from "#core/content/read.ts"
import type { FileContent } from "#core/session/handlers/file.ts"

/** What the script's content is, worked out once before reading the host's state. */
export interface ResolvedFileContent {
  bytes: Uint8Array
  size: Bytes
  hash: string
}

/** Gets the content's bytes, which reads a `Blob` like `bun.file(...)`, and works out their size and hash. */
export const resolveContent = async (content: FileContent): Promise<Result<ResolvedFileContent>> => {
  const bytes = await readContentBytes(content, "the content given to 'file'")
  if (isErr(bytes)) return bytes

  const hash = new CryptoHasher("sha256").update(bytes).digest("hex")
  return { bytes, size: toBytes(bytes.length), hash }
}
