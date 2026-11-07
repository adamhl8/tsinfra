import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import type { ExistingHostFileDetails } from "#session/handlers/file/host-file-details.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
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

const TEXT_DECODER = new TextDecoder()

// `TextDecoder` and the transport's `.text()` both put this character where a byte isn't valid UTF-8.
const REPLACEMENT_CHARACTER = "\uFFFD"

// Check decoded text on both sides, because the host's content is only available as text.
// Treat text with a NUL byte, or that wasn't valid UTF-8, as binary, because a line diff of it would be noise.
const isBinary = (text: string): boolean => text.includes("\0") || text.includes(REPLACEMENT_CHARACTER)

/** Works out how the content differs, fetching the old content only when the output can show a diff of it. */
export const compareContent = async (
  shell: Shell,
  hostFileDetails: ExistingHostFileDetails,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result<ContentComparison>> => {
  const { path, content: hostContentDetails } = hostFileDetails
  const { secret } = options

  const gotSize = hostContentDetails.size
  const wantSize = resolvedContent.size

  if (hostContentDetails.hash === resolvedContent.hash) return { kind: "same" }
  if (secret) return { kind: "hidden", gotSize, wantSize }
  if (gotSize > MAX_DIFF_BYTES || wantSize > MAX_DIFF_BYTES) return { kind: "large", gotSize, wantSize }

  const want = TEXT_DECODER.decode(resolvedContent.bytes)
  if (isBinary(want)) return { kind: "binary", gotSize, wantSize }

  const got = await shell.exec(`cat ${quoteShellArg(path)}`, { label: "file content" })
  if (isErr(got)) return err(`failed to read the content of '${path}'`, got)
  if (isBinary(got)) return { kind: "binary", gotSize, wantSize }

  return { kind: "text", got, want }
}
