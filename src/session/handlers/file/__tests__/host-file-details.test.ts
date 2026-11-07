import { describe, expect, it } from "bun:test"
import { chmod } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import { toBytes } from "#session/handlers/file/bytes.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import { getHostFileDetails, parseFileDetailsOutput } from "#session/handlers/file/host-file-details.ts"
import { createShell } from "#session/shell.ts"
import { runLocal } from "#transport/local.ts"

const HASH = "a".repeat(64)

const toDetails = (stdout: string, stderr = "") => {
  const details = parseFileDetailsOutput({ stdout, stderr, exitCode: 0 }, "/tmp/x")
  return isErr(details) ? messageChain(details) : details
}

describe("parseFileDetailsOutput", () => {
  it("should read GNU's hash and stat line", () => {
    expect(toDetails(`kind=file\n${HASH}  -\n644 501 20 adam staff 12\n`)).toStrictEqual({
      kind: "existing",
      path: "/tmp/x",
      content: { hash: HASH, size: toBytes(12) },
      attributes: { mode: 0o644, uid: 501, gid: 20, user: "adam", group: "staff" },
    })
  })

  it("should read BSD's bare hash and its zero-padded mode", () => {
    expect(toDetails(`kind=file\n${HASH}\n0644 0 0 root wheel 3\n`)).toStrictEqual({
      kind: "existing",
      path: "/tmp/x",
      content: { hash: HASH, size: toBytes(3) },
      attributes: { mode: 0o644, uid: 0, gid: 0, user: "root", group: "wheel" },
    })
  })

  it("should read a mode with setuid", () => {
    expect(toDetails(`kind=file\n${HASH}\n4755 0 0 root wheel 3\n`)).toMatchObject({ attributes: { mode: 0o4755 } })
  })

  it("should return new details when nothing is at the path", () => {
    expect(toDetails("kind=absent\n")).toStrictEqual({ kind: "new", path: "/tmp/x" })
  })

  it("should fail on a kind it doesn't know", () => {
    expect(toDetails("kind=socket\n")).toBe(
      "the file details command printed 'kind=socket' instead of what is at the path",
    )
  })

  it.each([
    "not a stat line",
    "644",
    "644 1000",
    "644 1000 1000 adam",
    "644 1000 1000 adam staff",
    "644 1000 1000 first last staff 15",
    "644 1000 1000 adam staff 0x10",
    "999 1000 1000 adam staff 15",
    "04755 1000 1000 adam staff 15",
  ])("should fail on the stat line '%s'", (statLine) => {
    expect(toDetails(`kind=file\n${HASH}\n${statLine}\n`)).toBe(
      `the file details command printed '${statLine}' instead of the file's mode, owner, and size`,
    )
  })

  // Leave out the hash line, because a failed sha256 command prints nothing, so the stat line takes its place.
  it("should say why when no sha256 command printed a hash", () => {
    expect(toDetails("kind=file\n644 0 0 root root 3\n", "sh: sha256sum: command not found\n")).toBe(
      "failed to get the sha256 hash of the file on the host -> sh: sha256sum: command not found",
    )
  })

  it("should still fail when a missing hash left nothing on stderr", () => {
    expect(toDetails("kind=file\n644 0 0 root root 3\n")).toBe("failed to get the sha256 hash of the file on the host")
  })
})

const writeTool = async (binDir: string, name: string, body: string) => {
  const toolPath = path.join(binDir, name)
  await Bun.write(toolPath, `#!/bin/sh\n${body}\n`)
  await chmod(toolPath, 0o755)
}

const toHash = (details: Result<HostFileDetails>) => {
  if (isErr(details)) return messageChain(details)
  return details.kind === "existing" ? details.content.hash : undefined
}

/** Reads a file's details on a host where `tools` are the only commands on `PATH`, apart from `stat`. */
const readDetailsWithTools = async (tools: Record<string, string>) => {
  const binDir = await makeTempDir()
  await writeTool(binDir, "stat", `exec '${Bun.which("stat")}' "$@"`)
  await Promise.all(Object.entries(tools).map(async ([name, body]) => writeTool(binDir, name, body)))
  const filePath = path.join(binDir, "file")
  await Bun.write(filePath, "a")

  let stderr = ""
  const shell = createShell(async (script) => {
    const output = await runLocal(`PATH='${binDir}'\n${script}`)
    if (!isErr(output)) ({ stderr } = output)
    return output
  })
  const details = await getHostFileDetails(shell, filePath)

  return { details: toHash(details), stderr: stderr.trim() }
}

describe("getHostFileDetails with sha256 tools", () => {
  const FAILING_TOOL = 'echo "tool broke" >&2; exit 1'
  const WORKING_TOOL = `echo '${HASH}  -'`

  it("should fall through a missing tool without writing to stderr", async () => {
    expect(await readDetailsWithTools({ shasum: WORKING_TOOL })).toStrictEqual({ details: HASH, stderr: "" })
  })

  it("should fall through a tool that fails, and keep its stderr", async () => {
    expect(await readDetailsWithTools({ sha256sum: FAILING_TOOL, shasum: WORKING_TOOL })).toStrictEqual({
      details: HASH,
      stderr: "tool broke",
    })
  })

  it("should fail with no cause when every tool is missing", async () => {
    expect(await readDetailsWithTools({})).toStrictEqual({
      details: "failed to get the sha256 hash of the file on the host",
      stderr: "",
    })
  })

  it("should fail with a tool's stderr when no tool works", async () => {
    expect(await readDetailsWithTools({ sha256sum: FAILING_TOOL })).toStrictEqual({
      details: "failed to get the sha256 hash of the file on the host -> tool broke",
      stderr: "tool broke",
    })
  })
})
