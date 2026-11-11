import crypto from "node:crypto"

import { CryptoHasher } from "bun"

/** The most content `file` takes. */
export const CONTENT_LIMIT_BYTES = 10_000_000

// Fill the bytes in chunks, because `getRandomValues` takes at most 65,536 bytes at a time.
const RANDOM_CHUNK_BYTES = 65_536

/** Returns `size` random bytes, which no compression or encoding can shorten. */
export const createRandomBytes = (size: number) => {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += RANDOM_CHUNK_BYTES)
    crypto.getRandomValues(bytes.subarray(index, index + RANDOM_CHUNK_BYTES))

  return bytes
}

/** Returns the SHA-256 of `bytes` in hex, the way `sha256sum` prints it. */
export const hashBytes = (bytes: Uint8Array) => new CryptoHasher("sha256").update(bytes).digest("hex")
