import { describe, expect, it } from "bun:test"
import { chmod, symlink } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { isErr, messageChain } from "ts-explicit-errors"

import { getHostLinkDetails, parseLinkDetailsOutput } from "#core/session/handlers/link/host-link-details.ts"
import { toModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { runLocal } from "#core/transport/local.ts"
import { createShell } from "#core/transport/shell.ts"

const OWNER = { uid: 501, gid: 20, user: "adam", group: "staff" }
const STAT_LINE = "501 20 adam staff"
const TARGET_STAT_LINE = "644 0 0 root wheel"
const TARGET_ATTRIBUTES = { mode: toModeBits(0o644), uid: 0, gid: 0, user: "root", group: "wheel" }

const toDetails = (stdout: string) => {
  const details = parseLinkDetailsOutput(stdout, "/tmp/x")
  return isErr(details) ? messageChain(details) : details
}

// Cover what a real shell can't easily produce here. The real command runs in `link.test.ts`.
describe("parseLinkDetailsOutput", () => {
  it("should read a target with a newline, and keep what readlink printed", () => {
    expect(toDetails(`kind=link\n${STAT_LINE}\n${TARGET_STAT_LINE}\n/a\nb\n`)).toStrictEqual({
      kind: "link",
      path: "/tmp/x",
      targetAttributes: TARGET_ATTRIBUTES,
      currentTarget: "/a\nb",
      owner: OWNER,
    })
  })

  it("should keep a newline at the end of a target", () => {
    expect(toDetails(`kind=link\n${STAT_LINE}\n${TARGET_STAT_LINE}\n/a\n\n`)).toMatchObject({ currentTarget: "/a\n" })
  })

  it("should read BSD's zero-padded mode on the target", () => {
    expect(toDetails(`kind=absent\n\n0600 501 20 adam staff\n`)).toStrictEqual({
      kind: "new",
      path: "/tmp/x",
      targetAttributes: { ...OWNER, mode: toModeBits(0o600) },
    })
  })

  it("should give no target attributes for a missing target", () => {
    expect(toDetails(`kind=file\n${STAT_LINE}\n\n`)).toStrictEqual({
      kind: "file",
      path: "/tmp/x",
      targetAttributes: undefined,
      owner: OWNER,
    })
  })

  it("should fail on a kind it doesn't know", () => {
    expect(toDetails("kind=socket\n")).toBe(
      "the link details script printed 'kind=socket' instead of what is at the path",
    )
  })

  it.each(["target=exists", "644 0 0 root", "rw-r--r-- 0 0 root wheel"])(
    "should fail on the target's stat line '%s'",
    (targetStatLine) => {
      expect(toDetails(`kind=file\n${STAT_LINE}\n${targetStatLine}\n`)).toBe(
        `the link details script printed '${targetStatLine}' instead of the mode and owner of the target`,
      )
    },
  )

  it.each(["", "501 20 adam", "501 20 first last staff", "x 20 adam staff"])(
    "should fail on the stat line '%s'",
    (statLine) => {
      expect(toDetails(`kind=file\n${statLine}\n\n`)).toBe(
        `the link details script printed '${statLine}' instead of the owner of the path`,
      )
    },
  )
})

describe("getHostLinkDetails", () => {
  it("should read the mode of the file at the end when the target is itself a link", async () => {
    const directory = await makeTempDir()
    const filePath = path.join(directory, "file")
    const target = path.join(directory, "target")
    await bun.write(filePath, "a")
    await chmod(filePath, 0o640)
    await symlink(filePath, target)
    const shell = createShell(async (cmd) => runLocal(cmd))

    const details = await getHostLinkDetails(shell, path.join(directory, "link"), target)

    expect(isErr(details) ? messageChain(details) : details.targetAttributes?.mode).toBe(toModeBits(0o640))
  })
})
