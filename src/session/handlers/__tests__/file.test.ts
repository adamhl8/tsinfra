import { describe, expect, it } from "bun:test"
import { chmod, mkdir, stat, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { messageChain } from "ts-explicit-errors"

import { castInvalid, createSession, fileOrMessage } from "#__tests__/session.ts"
import { handleFile } from "#session/handlers/file.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/file/mode.ts"

const CLOSED_FILE_DESCRIPTOR = 9999

const createFilePath = async () => path.join(await makeTempDir(), "app.conf")

describe("h.file in plan", () => {
  it("should report a new file without writing it", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("plan")
    const result = await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: true })
    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { kind: "file", content: { kind: "new", wantSize: 2 }, attributes: [] },
    })
    expect(await Bun.file(filePath).exists()).toBe(false)
  })

  it("should be unchanged when the content matches", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toMatchObject({ changed: false })
  })

  it("should fetch the old content for a diff when it differs", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\nb\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\nc\n")

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should label every command it runs, because the script didn't write them", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\nb\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\nc\n")

    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual([
      "file details command",
      "file content",
    ])
  })

  it("should report a mode that differs, and leave a mode that wasn't given alone", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { mode: "644" })
    await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(hostSession.stepRecords.map(({ comparisons }) => comparisons.before)).toMatchObject([
      {
        values: {
          content: { kind: "same" },
          attributes: [{ name: "mode", got: "rw------- (600)", want: "rw-r--r-- (644)" }],
        },
      },
      { inSync: true },
    ])
  })

  it("should show a mode in both notations, whichever one the script wrote", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { mode: PUBLIC_FILE_MODE })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { attributes: [{ name: "mode", got: "rw------- (600)", want: "rw-r--r-- (644)" }] },
    })
  })

  it("should compare a user name with the user's name, and a user id with its uid", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { username, uid } = os.userInfo()
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: username })
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: uid })
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: uid + 1 })

    expect(hostSession.stepRecords.map(({ comparisons }) => comparisons.before)).toMatchObject([
      { inSync: true },
      { inSync: true },
      { values: { attributes: [{ name: "user", got: String(uid), want: String(uid + 1) }] } },
    ])
  })

  it("should report a group that differs", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const { gid } = await stat(filePath)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { group: gid + 1 })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { attributes: [{ name: "group", got: String(gid), want: String(gid + 1) }] },
    })
  })

  it("should never fetch the old content of a secret file", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "old token\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "new token\n", { secret: true })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "hidden" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff binary content", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, new Uint8Array([0, 1, 2]))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should not fetch a file over 100 kB for a diff", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a".repeat(200 * 1024))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "b\n")

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff new content over 100 kB", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "b".repeat(200 * 1024))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should resolve ~/ to the SSH user's home", async () => {
    const relativePath = `.tsinfra-test-${crypto.randomUUID()}`
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, `~/${relativePath}`, "a\n")

    const commands = hostSession.stepRecords[0]?.commands.map(({ cmd }) => cmd).join("\n")
    expect(commands).toContain(`'${path.join(os.homedir(), relativePath)}'`)
  })
})

describe("h.file content", () => {
  const CONTENT = "héllo\n"

  it.each([
    ["a string", () => CONTENT],
    ["bytes", () => new TextEncoder().encode(CONTENT)],
    ["a Blob", () => new Blob([CONTENT])],
  ])("should treat %s as the same content", async (_, toContent) => {
    const filePath = await createFilePath()
    await Bun.write(filePath, CONTENT)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, toContent())).toMatchObject({ changed: false })
  })

  it("should read a local file given with Bun.file, and diff it", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\nb\n")
    const localPath = await createFilePath()
    await Bun.write(localPath, "a\nc\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, Bun.file(localPath))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should not diff binary content from a local file", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const localPath = await createFilePath()
    await Bun.write(localPath, new Uint8Array([0, 1, 2]))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, Bun.file(localPath))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should fail on a missing local file", async () => {
    const localPath = await createFilePath()
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", Bun.file(localPath))).toBe(
      `failed to read local file '${localPath}' -> ENOENT: no such file or directory, open '${localPath}'`,
    )
  })

  it("should fail on a local path that is a directory", async () => {
    const localPath = await makeTempDir()
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", Bun.file(localPath))).toBe(
      `failed to read local file '${localPath}' -> Directories cannot be read like files`,
    )
  })

  it("should fail on content it can't read and can't name", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", Bun.file(CLOSED_FILE_DESCRIPTOR))).toBe(
      "failed to read the content given to 'file' -> EBADF: bad file descriptor, fstat",
    )
  })

  it("should fail on a missing local file even when the step would wait", async () => {
    const localPath = await createFilePath()
    const { host: h } = await createSession("plan")
    const needed = await h.file(await createFilePath(), "a\n")

    expect(await fileOrMessage(h, "/tmp/x", Bun.file(localPath), { needs: [needed] })).toBe(
      `failed to read local file '${localPath}' -> ENOENT: no such file or directory, open '${localPath}'`,
    )
  })
})

describe("h.file refusals", () => {
  it.each(["app.conf", "./app.conf", "~bob/app.conf", "~bob"])("should refuse the path '%s'", async (filePath) => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to validate the path given to 'file' -> must be an absolute path, starting with / or ~/ (was "${filePath}")`,
    )
  })

  it("should refuse a symlink", async () => {
    const filePath = await createFilePath()
    await symlink("/etc/hosts", filePath)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to compare the host with what the step wants -> '${filePath}' is a symlink, so file won't replace it`,
    )
  })

  it("should refuse a directory", async () => {
    const filePath = await createFilePath()
    await mkdir(filePath)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to compare the host with what the step wants -> '${filePath}' isn't a regular file, so file won't replace it`,
    )
  })

  it("should say a file the SSH user can't read needs sudo", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o000)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to compare the host with what the step wants -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
    )
  })

  it("should fail in apply, because the write comes with part 2", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to run the fix -> writing files comes with part 2 of file`,
    )
  })
})

describe("h.file with invalid input", () => {
  it("should fail content that is neither a string, bytes, nor a Blob", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", castInvalid(1))).toBe(
      "failed to validate the content given to 'file' -> must be a string, bytes, or a Blob",
    )
  })

  it("should fail the old call that gave content in the options", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", castInvalid({ content: "a\n" }))).toBe(
      "failed to validate the content given to 'file' -> must be a string, bytes, or a Blob",
    )
  })

  it("should fail options that aren't an object", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", "a\n", castInvalid(1))).toBe(
      "failed to validate the options given to 'file' -> must be an object (was a number)",
    )
  })
})

describe("handleFile", () => {
  // Call the handler directly, because `h.file` rejects this path first, when it validates the step's name.
  it("should fail a path that isn't a string", async () => {
    const result = await handleFile(castInvalid({ stepName: "x", kind: "file" }), 1, "a\n")

    expect(result).toBeInstanceOf(Error)
    expect(messageChain(castInvalid(result))).toBe(
      "failed to validate the path given to 'file' -> must be an absolute path, starting with / or ~/ (was a number)",
    )
  })
})
