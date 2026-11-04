import { describe, expect, it } from "bun:test"
import { chmod, mkdir, stat, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { messageChain } from "ts-explicit-errors"

import { castInvalid, createSession, fileOrMessage } from "#__tests__/session.ts"
import { handleFile } from "#session/handlers/file.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/file/mode.ts"

const createFilePath = async () => path.join(await makeTempDir(), "app.conf")

describe("h.file in plan", () => {
  it("should report a new file without writing it", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("plan")
    const result = await fileOrMessage(hostSession.host, filePath, { content: "a\n" })

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: true })
    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({
      values: { kind: "file", content: { kind: "new", wantSize: 2 }, attributes: [] },
    })
    expect(await Bun.file(filePath).exists()).toBe(false)
  })

  it("should be unchanged when the content matches", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toMatchObject({ changed: false })
  })

  it("should fetch the old content for a diff when it differs", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\nb\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\nc\n" })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({
      values: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should report a mode that differs, and leave a mode that wasn't given alone", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", mode: "644" })
    await fileOrMessage(hostSession.host, filePath, { content: "a\n" })

    expect(hostSession.stepRecords.map(({ outcome }) => outcome)).toMatchObject([
      {
        values: {
          content: { kind: "same" },
          attributes: [{ name: "mode", got: "rw------- (600)", want: "rw-r--r-- (644)" }],
        },
      },
      { status: "unchanged" },
    ])
  })

  it("should show a mode in both notations, whichever one the script wrote", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", mode: PUBLIC_FILE_MODE })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({
      values: { attributes: [{ name: "mode", got: "rw------- (600)", want: "rw-r--r-- (644)" }] },
    })
  })

  it("should compare an owner name with the owner's name, and an owner id with its uid", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { username, uid } = os.userInfo()
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", owner: username })
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", owner: uid })
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", owner: uid + 1 })

    expect(hostSession.stepRecords.map(({ outcome }) => outcome)).toMatchObject([
      { status: "unchanged" },
      { status: "unchanged" },
      { values: { attributes: [{ name: "owner", got: String(uid), want: String(uid + 1) }] } },
    ])
  })

  it("should report a group that differs", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { gid } = await stat(filePath)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", group: gid + 1 })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({
      values: { attributes: [{ name: "group", got: String(gid), want: String(gid + 1) }] },
    })
  })

  it("should never fetch the old content of a secret file", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "old token\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "new token\n", secret: true })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({ values: { content: { kind: "hidden" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff binary content", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: new Uint8Array([0, 1, 2]) })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({
      values: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should not fetch a file over 100 kB for a diff", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a".repeat(200 * 1024))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "b\n" })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({ values: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff new content over 100 kB", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "b".repeat(200 * 1024) })

    expect(hostSession.stepRecords[0]?.outcome).toMatchObject({ values: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should resolve ~/ to the SSH user's home", async () => {
    const relativePath = `.tsinfra-test-${crypto.randomUUID()}`
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, `~/${relativePath}`, { content: "a\n" })

    const commands = hostSession.stepRecords[0]?.commands.map(({ cmd }) => cmd).join("\n")
    expect(commands).toContain(`'${path.join(os.homedir(), relativePath)}'`)
  })
})

describe("h.file refusals", () => {
  it("should refuse a relative path", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "app.conf", { content: "a\n" })).toBe(
      "'app.conf' isn't an absolute path, so start it with / or ~/",
    )
  })

  it("should refuse a symlink", async () => {
    const filePath = await createFilePath()
    await symlink("/etc/hosts", filePath)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to compare the host with what step '${filePath}' wants -> '${filePath}' is a symlink, so file won't replace it`,
    )
  })

  it("should refuse a directory", async () => {
    const filePath = await createFilePath()
    await mkdir(filePath)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to compare the host with what step '${filePath}' wants -> '${filePath}' isn't a regular file, so file won't replace it`,
    )
  })

  it("should say a file the SSH user can't read needs sudo", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o000)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to compare the host with what step '${filePath}' wants -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
    )
  })

  it("should fail in apply, because the write comes with part 2", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to run the fix for step '${filePath}' -> writing files comes with part 2 of file`,
    )
  })
})

describe("h.file with invalid input", () => {
  it("should fail a file whose content is neither a string nor bytes", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", { content: castInvalid(1) })).toBe(
      "failed to validate the options given to step '/tmp/x' -> content must be a string or an object (was a number)",
    )
  })
})

describe("handleFile", () => {
  // Call the handler directly, because `h.file` rejects this path first, when it validates the step's name.
  it("should fail a path that isn't a string", async () => {
    const result = await handleFile(castInvalid({ stepName: "x" }), 1, {})

    expect(result).toBeInstanceOf(Error)
    expect(messageChain(castInvalid(result))).toBe(
      "failed to validate the path given to 'file' -> must be a string (was a number)",
    )
  })
})
