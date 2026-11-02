import { describe, expect, it } from "bun:test"
import { chmod, mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { isErr, messageChain } from "ts-explicit-errors"

import { createSession, fileOrMessage } from "#__tests__/session.ts"
import { parseCheckOutput } from "#session/steps/file.ts"
import { toBytes } from "#session/steps/file/comparison.ts"
import { PUBLIC_FILE_MODE } from "#session/steps/file/mode.ts"

const HASH = "a".repeat(64)

const toFindings = (stdout: string) => {
  const findings = parseCheckOutput(stdout)
  return isErr(findings) ? messageChain(findings) : findings
}

const createFilePath = async () => path.join(await makeTempDir("file-"), "app.conf")

describe("parseCheckOutput", () => {
  it("should read GNU's hash and stat line", () => {
    expect(toFindings(`kind=file\n${HASH}  -\n644 501 20 adam staff 12\n`)).toStrictEqual({
      kind: "file",
      remoteFile: { hash: HASH, mode: 0o644, uid: 501, gid: 20, user: "adam", group: "staff", size: toBytes(12) },
    })
  })

  it("should read BSD's bare hash and its zero-padded mode, setuid included", () => {
    expect(toFindings(`kind=file\n${HASH}\n04755 0 0 root wheel 3\n`)).toStrictEqual({
      kind: "file",
      remoteFile: { hash: HASH, mode: 0o4755, uid: 0, gid: 0, user: "root", group: "wheel", size: toBytes(3) },
    })
  })

  it("should fail when no sha256 command printed a hash", () => {
    expect(toFindings("kind=file\n\n644 0 0 root root 3\n")).toBe(
      "the file check found no sha256 command (sha256sum, shasum, or sha256) on the host",
    )
  })
})

describe("h.file in plan", () => {
  it("should report a new file without writing it", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("plan")
    const result = await fileOrMessage(hostSession.host, filePath, { content: "a\n" })

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: true })
    expect(hostSession.stepRecords[0]?.details).toMatchObject({
      comparison: { kind: "file", content: { kind: "new", wantSize: 2 }, attributes: [] },
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

    expect(hostSession.stepRecords[0]?.details).toMatchObject({
      comparison: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should report a mode that differs, and leave a mode that wasn't given alone", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "a\n", mode: "644" })
    await fileOrMessage(hostSession.host, filePath, { content: "a\n" })

    expect(hostSession.stepRecords.map(({ details }) => details)).toMatchObject([
      {
        comparison: {
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

    expect(hostSession.stepRecords[0]?.details).toMatchObject({
      comparison: { attributes: [{ name: "mode", got: "rw------- (600)", want: "rw-r--r-- (644)" }] },
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

    expect(hostSession.stepRecords.map(({ details }) => details)).toMatchObject([
      { status: "unchanged" },
      { status: "unchanged" },
      { comparison: { attributes: [{ name: "owner", got: String(uid), want: String(uid + 1) }] } },
    ])
  })

  it("should never fetch the old content of a secret file", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "old token\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "new token\n", secret: true })

    expect(hostSession.stepRecords[0]?.details).toMatchObject({ comparison: { content: { kind: "hidden" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff binary content", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: new Uint8Array([0, 1, 2]) })

    expect(hostSession.stepRecords[0]?.details).toMatchObject({
      comparison: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should not fetch a file over 100 kB for a diff", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a".repeat(200 * 1024))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "b\n" })

    expect(hostSession.stepRecords[0]?.details).toMatchObject({ comparison: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff new content over 100 kB", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, { content: "b".repeat(200 * 1024) })

    expect(hostSession.stepRecords[0]?.details).toMatchObject({ comparison: { content: { kind: "large" } } })
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
      `failed to read the host's state for step '${filePath}' -> '${filePath}' is a symlink, so file won't replace it`,
    )
  })

  it("should refuse a directory", async () => {
    const filePath = await createFilePath()
    await mkdir(filePath)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to read the host's state for step '${filePath}' -> '${filePath}' isn't a regular file, so file won't replace it`,
    )
  })

  it("should say a file the SSH user can't read needs sudo", async () => {
    const filePath = await createFilePath()
    await Bun.write(filePath, "a\n")
    await chmod(filePath, 0o000)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, { content: "a\n" })).toBe(
      `failed to read the host's state for step '${filePath}' -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
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
