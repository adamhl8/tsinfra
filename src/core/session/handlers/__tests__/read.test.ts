import { describe, expect, it } from "bun:test"
import { truncate } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { CONTENT_LIMIT_BYTES } from "#core/__tests__/content.ts"
import {
  castInvalid,
  createSession,
  getFailureMessage,
  getStepRecords,
  readOrMessage,
} from "#core/__tests__/session.ts"

describe("h.read", () => {
  it("should return stdout trimmed", async () => {
    const hostSession = await createSession()

    expect(await hostSession.host.read(String.raw`printf '  a\nb  \n\n'`)).toBe("a\nb")
  })

  it("should throw and record a failure with the exit code and stderr when the command fails", async () => {
    const hostSession = await createSession()
    const message = "failed to read 'echo oops >&2; exit 3' -> exited with code 3: oops"

    expect(await readOrMessage(hostSession.host, "echo oops >&2; exit 3")).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the command isn't a string", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, castInvalid(1))).toBe(
      "failed to validate the command given to 'read' -> must be a string (was a number)",
    )
  })

  it("should leave stderr out of the failure when it's empty", async () => {
    const hostSession = await createSession()

    expect(await readOrMessage(hostSession.host, "exit 1")).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})

describe("h.read with input", () => {
  it("should give the command the input on its stdin", async () => {
    const { host: h } = await createSession()

    expect(await h.read("cat", { input: "a\nb" })).toBe("a\nb")
  })

  it("should read a Blob from a local file as the input", async () => {
    const localPath = path.join(await makeTempDir(), "input.txt")
    await bun.write(localPath, "from a file")
    const { host: h } = await createSession()

    expect(await h.read("cat", { input: bun.file(localPath) })).toBe("from a file")
  })

  it("should fail the host on input over the limit, and run nothing", async () => {
    const hostSession = await createSession()
    const message = "failed to read 'cat' -> the input is 10 MB, above the 10 MB limit"

    expect(await readOrMessage(hostSession.host, "cat", { input: "a".repeat(CONTENT_LIMIT_BYTES + 1) })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(getStepRecords(hostSession.hostRecord)[0]?.commands).toStrictEqual([])
  })

  // Use a sparse file, so the test never writes 10 MB to disk.
  it("should name the local file when a Blob is over the limit", async () => {
    const localPath = path.join(await makeTempDir(), "big.bin")
    await bun.write(localPath, "")
    await truncate(localPath, CONTENT_LIMIT_BYTES + 1)
    const { host: h } = await createSession()

    expect(await readOrMessage(h, "cat", { input: bun.file(localPath) })).toBe(
      `failed to read 'cat' -> local file '${localPath}' is 10 MB, above the 10 MB limit`,
    )
  })

  it("should fail the host when the input isn't a string, bytes, or a Blob", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, "cat", { input: castInvalid(5) })).toBe(
      "failed to validate the options given to 'read' -> input must be a string, bytes, or a Blob (was 5)",
    )
  })
})
