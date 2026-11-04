import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import { formatMode, toModeBits } from "#session/handlers/file/mode.ts"
import type { HostFile } from "#session/handlers/file/state-command.ts"
import type { WantedFile } from "#session/handlers/file/wanted-file.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#session/shell.ts"

/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparisonValues {
  kind: "file"
  content: ContentComparison
  attributes: AttributeChange[]
}

/** How a managed file's content differs. `text` holds both sides for a diff. */
export type ContentComparison = { kind: "same" } | { kind: "text"; got: string; want: string } | SizeComparison

/** Compares only the sizes, because the text can't be shown. `kind` says why, and `gotSize` is unset for a new file. */
export interface SizeComparison {
  kind: "new" | "hidden" | "binary" | "large"
  gotSize?: Bytes
  wantSize: Bytes
}

/** A managed attribute of a file whose value differs, as the output shows it. */
export interface AttributeChange {
  name: "mode" | "owner" | "group"
  got: string
  want: string
}

// Skip the diff when either side is above this size, because fetching and diffing a large file costs more than the diff tells.
const MAX_DIFF_BYTES = toBytes(100_000) // 100 kB

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

// Treat content with a NUL byte, or that isn't valid UTF-8, as binary, because a line diff of it would be noise.
const decodeText = (bytes: Uint8Array): string | undefined => {
  const text = attempt(() => TEXT_DECODER.decode(bytes))
  return isErr(text) || text.includes("\0") ? undefined : text
}

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (hostFile: HostFile, wantedFile: WantedFile): AttributeChange[] => {
  const { mode, owner, group } = wantedFile
  const changes: AttributeChange[] = []

  // Compare only the permission bits, because the type bits aren't something a file step sets.
  const gotMode = hostFile.mode % 0o1_0000
  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: formatMode(gotMode), want: formatMode(wantMode) })

  const gotOwner = typeof owner === "number" ? hostFile.uid : hostFile.user
  if (owner !== undefined && gotOwner !== owner)
    changes.push({ name: "owner", got: String(gotOwner), want: String(owner) })

  const gotGroup = typeof group === "number" ? hostFile.gid : hostFile.group
  if (group !== undefined && gotGroup !== group)
    changes.push({ name: "group", got: String(gotGroup), want: String(group) })

  return changes
}

interface CompareContentInput {
  shell: Shell
  path: string
  secret: boolean
  wantedFile: WantedFile
  hostFile: HostFile
}

/** Works out how the content differs, fetching the old content only when the output can show a diff of it. */
export const compareContent = async (input: CompareContentInput): Promise<Result<ContentComparison>> => {
  const { shell, path, secret, wantedFile, hostFile } = input
  const { bytes, size: wantSize, hash } = wantedFile
  const { size: gotSize } = hostFile

  if (hostFile.hash === hash) return { kind: "same" }
  if (secret) return { kind: "hidden", gotSize, wantSize }
  if (gotSize > MAX_DIFF_BYTES || wantSize > MAX_DIFF_BYTES) return { kind: "large", gotSize, wantSize }

  const want = decodeText(bytes)
  if (want === undefined) return { kind: "binary", gotSize, wantSize }

  const got = await shell.exec(`cat -- ${quoteShellArg(path)}`)
  if (isErr(got)) return err(`failed to read '${path}' for its diff`, got)
  if (got.includes("\0") || got.includes("�")) return { kind: "binary", gotSize, wantSize }

  return { kind: "text", got, want }
}
