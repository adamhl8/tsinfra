import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { CONTENT_LIMIT_BYTES, createRandomBytes, hashBytes } from "#__tests__/content.ts"
import { createSessionOn, fileOrMessage } from "#__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#__tests__/sshd.ts"
import type { Host } from "#session/session.ts"
import { closeConnections } from "#transport/transport.ts"

/** Runs `h.file` over ssh in a new session, like a later run of the script. */
const applyFileOverSsh = async (...fileArgs: Parameters<Host["file"]>) => {
  const { host: h } = await createSessionOn(SSHD_TARGET, "apply")
  return fileOrMessage(h, ...fileArgs)
}

beforeAll(async () => {
  await startSshd()
})

afterAll(async () => {
  await closeConnections([SSHD_TARGET])
  await stopSshd()
})

// Check the write over ssh, because ssh hands the script to the host's `sh` in pieces as it arrives.
describe("h.file over ssh", () => {
  it.each([
    ["as the SSH user", false],
    ["with sudo: true", true],
  ])("should write 10 MB of binary content intact %s, and be unchanged on the next apply", async (_, sudo) => {
    const filePath = path.join(await makeTempDir(), "big.bin")
    const bytes = createRandomBytes(CONTENT_LIMIT_BYTES)

    expect(await applyFileOverSsh(filePath, bytes, { sudo })).toMatchObject({ changed: true })
    expect(hashBytes(await bun.file(filePath).bytes())).toBe(hashBytes(bytes))
    expect(await applyFileOverSsh(filePath, bytes, { sudo })).toMatchObject({ changed: false })
  })

  it("should write to a path with a quote and a newline", async () => {
    const filePath = path.join(await makeTempDir(), "it's a\nnew line")

    expect(await applyFileOverSsh(filePath, "a\n")).toMatchObject({ changed: true })
    expect(await bun.file(filePath).text()).toBe("a\n")
  })
})
