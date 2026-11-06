import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import type { HostFileDetails } from "#session/handlers/file/comparison/host-file-details.ts"
import type { FileContentDetails } from "#session/handlers/file/content-details.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#session/shell.ts"

/** How a managed file's content differs. `text` holds both sides for a diff. */
export type ContentComparison = { kind: "same" } | { kind: "text"; got: string; want: string } | SizeComparison

/** Compares only the sizes, because the text can't be shown. `kind` says why, and `gotSize` is unset for a new file. */
export interface SizeComparison {
  kind: "new" | "hidden" | "binary" | "large"
  gotSize?: Bytes
  wantSize: Bytes
}

// Skip the diff when either side is above this size, because fetching and diffing a large file costs more than the diff tells.
const MAX_DIFF_BYTES = toBytes(100_000) // 100 kB

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

// Treat content with a NUL byte, or that isn't valid UTF-8, as binary, because a line diff of it would be noise.
const decodeText = (bytes: Uint8Array): string | undefined => {
  const text = attempt(() => TEXT_DECODER.decode(bytes))
  return isErr(text) || text.includes("\0") ? undefined : text
}

/** Works out how the content differs, fetching the old content only when the output can show a diff of it. */
// oxlint-disable-next-line eslint/max-params - this matches the shape of `compareFile`
export const compareContent = async (
  shell: Shell,
  hostFileDetails: HostFileDetails,
  contentDetails: FileContentDetails,
  options: ValidFileOptions,
): Promise<Result<ContentComparison>> => {
  const { path, size: gotSize } = hostFileDetails
  const { bytes, size: wantSize, hash } = contentDetails
  const { secret } = options

  if (hostFileDetails.hash === hash) return { kind: "same" }
  if (secret) return { kind: "hidden", gotSize, wantSize }
  if (gotSize > MAX_DIFF_BYTES || wantSize > MAX_DIFF_BYTES) return { kind: "large", gotSize, wantSize }

  const want = decodeText(bytes)
  if (want === undefined) return { kind: "binary", gotSize, wantSize }

  const got = await shell.exec(`cat -- ${quoteShellArg(path)}`, { label: "file content" })
  if (isErr(got)) return err(`failed to read '${path}' for its diff`, got)
  if (got.includes("\0") || got.includes("�")) return { kind: "binary", gotSize, wantSize }

  return { kind: "text", got, want }
}
