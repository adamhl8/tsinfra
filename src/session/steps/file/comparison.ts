import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#session/shell.ts"
import { formatMode, toModeBits } from "#session/steps/file/mode.ts"
import type { RemoteFile } from "#session/steps/file/state-command.ts"
import type { WantedFile } from "#session/steps/file/wanted-file.ts"

/** How a file on the host differs from what the script wants: its content, and each managed attribute that differs. */
export interface FileComparison {
  kind: "file"
  content: FileContent
  attributes: AttributeChange[]
}

/** How a managed file's content differs. `text` holds both sides for a diff, and a `FileNote` stands in for one. */
export type FileContent = { kind: "same" } | { kind: "text"; got: string; want: string } | FileNote

/** Why the output shows a note in place of a diff, with the sizes. `gotSize` is unset for a new file. */
export interface FileNote {
  kind: "new" | "hidden" | "binary" | "large"
  gotSize?: Bytes
  wantSize: Bytes
}

/** Reports whether a file's content is a note in place of a diff. */
export const isFileNote = (content: FileContent): content is FileNote =>
  content.kind !== "same" && content.kind !== "text"

/** A managed attribute of a file whose value differs, as the output shows it. */
export interface AttributeChange {
  name: "mode" | "owner" | "group"
  got: string
  want: string
}

declare const BYTES_BRAND: unique symbol

/** A size in bytes. Only `toBytes` makes one, so a plain number can't stand in for a size. */
export type Bytes = number & { readonly [BYTES_BRAND]: true }
// oxlint-disable-next-line typescript/no-unsafe-type-assertion - a brand exists only in the types, so only `as` can make one
export const toBytes = (count: number): Bytes => count as Bytes

// Skip the diff when either side is above this size, because fetching and diffing a large file costs more than the diff tells.
const MAX_DIFF_BYTES = toBytes(100_000) // 100 kB

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

// Treat content with a NUL byte, or that isn't valid UTF-8, as binary, because a line diff of it would be noise.
const decodeText = (bytes: Uint8Array): string | undefined => {
  const text = attempt(() => TEXT_DECODER.decode(bytes))
  return isErr(text) || text.includes("\0") ? undefined : text
}

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (remoteFile: RemoteFile, wantedFile: WantedFile): AttributeChange[] => {
  const { mode, owner, group } = wantedFile
  const changes: AttributeChange[] = []

  // Compare only the permission bits, because the type bits aren't something a file step sets.
  const gotMode = remoteFile.mode % 0o1_0000
  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: formatMode(gotMode), want: formatMode(wantMode) })

  const gotOwner = typeof owner === "number" ? remoteFile.uid : remoteFile.user
  if (owner !== undefined && gotOwner !== owner)
    changes.push({ name: "owner", got: String(gotOwner), want: String(owner) })

  const gotGroup = typeof group === "number" ? remoteFile.gid : remoteFile.group
  if (group !== undefined && gotGroup !== group)
    changes.push({ name: "group", got: String(gotGroup), want: String(group) })

  return changes
}

interface CompareContentInput {
  shell: Shell
  path: string
  secret: boolean
  wantedFile: WantedFile
  remoteFile: RemoteFile
}

/** Works out how the content differs, fetching the old content only when the output can show a diff of it. */
export const compareContent = async (input: CompareContentInput): Promise<Result<FileContent>> => {
  const { shell, path, secret, wantedFile, remoteFile } = input
  const { bytes, size: wantSize, hash } = wantedFile
  const { size: gotSize } = remoteFile

  if (remoteFile.hash === hash) return { kind: "same" }
  if (secret) return { kind: "hidden", gotSize, wantSize }
  if (gotSize > MAX_DIFF_BYTES || wantSize > MAX_DIFF_BYTES) return { kind: "large", gotSize, wantSize }

  const want = decodeText(bytes)
  if (want === undefined) return { kind: "binary", gotSize, wantSize }

  const got = await shell.run(`cat -- ${quoteShellArg(path)}`)
  if (isErr(got)) return err(`failed to read '${path}' for its diff`, got)
  if (got.includes("\0") || got.includes("�")) return { kind: "binary", gotSize, wantSize }

  return { kind: "text", got, want }
}
