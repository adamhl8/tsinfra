import { describe, expect, it } from "bun:test"
import { Buffer } from "node:buffer"
import crypto from "node:crypto"
import { chmod, lstat, mkdir, readdir, stat, symlink, truncate } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { messageChain } from "ts-explicit-errors"

import {
  castInvalid,
  createFakeSudoSession,
  createFakeToolSession,
  createSession,
  fileOrMessage,
} from "#__tests__/session.ts"
import { handleFile } from "#session/handlers/file.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/shared/filesystem/mode.ts"

const CLOSED_FILE_DESCRIPTOR = 9999

const createFilePath = async () => path.join(await makeTempDir(), "app.conf")

const isRoot = process.getuid?.() === 0

/** Returns a group id above all of the user's own, so `chown` to it fails. */
const getOtherGroupId = () => Math.max(os.userInfo().gid, ...(process.getgroups?.() ?? [])) + 1

/** Applies new content to `filePath` and returns the write script from the record. */
const getWriteScript = async (filePath: string) => {
  const hostSession = await createSession("apply")
  await fileOrMessage(hostSession.host, filePath, "new\n")

  return hostSession.stepRecords[0]?.commands.find(({ label }) => label === "file write script")?.cmd
}

describe("h.file in plan", () => {
  it("should report a new file without writing it", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("plan")
    const result = await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: true })
    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { kind: "file", content: { kind: "new", wantSize: 2 }, attributeChanges: [] },
    })
    expect(await bun.file(filePath).exists()).toBe(false)
  })

  it("should be unchanged when the content matches", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toMatchObject({ changed: false })
  })

  it("should fetch the old content for a diff when it differs", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\nb\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\nc\n")

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should label every command it runs, because the script didn't write them", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\nb\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\nc\n")

    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual([
      "file details script",
      "file content",
      "user command",
    ])
  })

  it("should report a mode that differs, and leave a mode that wasn't given alone", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { mode: "644" })
    await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(hostSession.stepRecords.map(({ comparisons }) => comparisons.before)).toMatchObject([
      {
        values: {
          content: { kind: "same" },
          attributeChanges: [{ name: "mode", got: 0o600, want: 0o644 }],
        },
      },
      { inSync: true },
    ])
  })

  it("should show a mode in both notations, whichever one the script wrote", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { mode: PUBLIC_FILE_MODE })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { attributeChanges: [{ name: "mode", got: 0o600, want: 0o644 }] },
    })
  })

  it("should compare a user name with the user's name, and a user id with its uid", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const { username, uid } = os.userInfo()
    const { hostSession } = await createFakeSudoSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: username, sudo: true })
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: uid, sudo: true })
    await fileOrMessage(hostSession.host, filePath, "a\n", { user: uid + 1, sudo: true })

    expect(hostSession.stepRecords.map(({ comparisons }) => comparisons.before)).toMatchObject([
      { inSync: true },
      { inSync: true },
      { values: { attributeChanges: [{ name: "user", got: uid, want: uid + 1 }] } },
    ])
  })

  it("should report a group that differs", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const { gid } = await stat(filePath)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n", { group: gid + 1 })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { attributeChanges: [{ name: "group", got: gid, want: gid + 1 }] },
    })
  })

  it("should never fetch the old content of a secret file", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "old token\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "new token\n", { secret: true })

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "hidden" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it.each([
    ["a NUL byte", new Uint8Array([97, 0, 98])],
    ["bytes that aren't valid UTF-8", new Uint8Array([97, 255, 98])],
  ])("should not diff wanted content with %s", async (_, bytes) => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, bytes)

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "binary" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it.each([
    ["a NUL byte", new Uint8Array([97, 0, 98])],
    ["bytes that aren't valid UTF-8", new Uint8Array([97, 255, 98])],
  ])("should not diff a host file with %s", async (_, bytes) => {
    const filePath = await createFilePath()
    await bun.write(filePath, bytes)
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "binary" } } })
  })

  it("should not diff binary content", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, new Uint8Array([0, 1, 2]))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should not fetch a file over 100 kB for a diff", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a".repeat(200 * 1024))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, "b\n")

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({ values: { content: { kind: "large" } } })
    expect(hostSession.stepRecords[0]?.commands.some(({ cmd }) => cmd.startsWith("cat "))).toBe(false)
  })

  it("should not diff new content over 100 kB", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
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
    await bun.write(filePath, CONTENT)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, toContent())).toMatchObject({ changed: false })
  })

  it("should read a local file given with bun.file, and diff it", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\nb\n")
    const localPath = await createFilePath()
    await bun.write(localPath, "a\nc\n")
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, bun.file(localPath))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "text", got: "a\nb\n", want: "a\nc\n" } },
    })
  })

  it("should not diff binary content from a local file", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    const localPath = await createFilePath()
    await bun.write(localPath, new Uint8Array([0, 1, 2]))
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, filePath, bun.file(localPath))

    expect(hostSession.stepRecords[0]?.comparisons.before).toMatchObject({
      values: { content: { kind: "binary", gotSize: 2, wantSize: 3 } },
    })
  })

  it("should fail on a missing local file", async () => {
    const localPath = await createFilePath()
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", bun.file(localPath))).toBe(
      `failed to read local file '${localPath}' -> ENOENT: no such file or directory, open '${localPath}'`,
    )
  })

  it("should fail on a local path that is a directory", async () => {
    const localPath = await makeTempDir()
    const { host: h } = await createSession("plan")

    // Check only that the error names the path, because Linux gives a directory a size of `Infinity`, and macOS doesn't.
    expect(await fileOrMessage(h, "/tmp/x", bun.file(localPath))).toContain(`local file '${localPath}'`)
  })

  it("should fail on content it can't read and can't name", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", bun.file(CLOSED_FILE_DESCRIPTOR))).toBe(
      "failed to read the content given to 'file' -> EBADF: bad file descriptor, fstat",
    )
  })

  it("should fail on a missing local file even when the step would wait", async () => {
    const localPath = await createFilePath()
    const { host: h } = await createSession("plan")
    const needed = await h.file(await createFilePath(), "a\n")

    expect(await fileOrMessage(h, "/tmp/x", bun.file(localPath), { needs: [needed] })).toBe(
      `failed to read local file '${localPath}' -> ENOENT: no such file or directory, open '${localPath}'`,
    )
  })
})

describe("h.file owner check", () => {
  // Use `/etc/hosts`, because it's a real file owned by root that everyone can read.
  const ROOT_OWNED_PATH = "/etc/hosts"
  const FAKE_UID = 1234

  it.skipIf(isRoot).each(["plan", "apply"] as const)("should refuse another user's name in %s", async (mode) => {
    const filePath = await createFilePath()
    const hostSession = await createSession(mode)

    expect(await fileOrMessage(hostSession.host, filePath, "a\n", { user: "root" })).toBe(
      "failed to compare the host with what the step wants -> user 'root' needs sudo: true, because only root can change a file's owner to another user",
    )
    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual([
      "file details script",
      "user command",
    ])
    expect(await bun.file(filePath).exists()).toBe(false)
  })

  it.skipIf(isRoot)("should refuse another user's id", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: os.userInfo().uid + 1 })).toBe(
      `failed to compare the host with what the step wants -> user '${os.userInfo().uid + 1}' needs sudo: true, because only root can change a file's owner to another user`,
    )
  })

  it("should write with the user's own name and id", async () => {
    const { username, uid } = os.userInfo()
    const namePath = await createFilePath()
    const idPath = await createFilePath()
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, namePath, "a\n", { user: username })).toMatchObject({ changed: true })
    expect(await fileOrMessage(h, idPath, "a\n", { user: uid })).toMatchObject({ changed: true })
    expect(await bun.file(namePath).text()).toBe("a\n")
    expect(await bun.file(idPath).text()).toBe("a\n")
  })

  it.skipIf(isRoot)("should refuse to write a file someone else owns", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, ROOT_OWNED_PATH, "new\n")).toBe(
      `failed to compare the host with what the step wants -> '${ROOT_OWNED_PATH}' is owned by 'root', so writing it needs sudo: true`,
    )
  })

  it("should pass a file someone else owns when it's in sync", async () => {
    const content = await bun.file(ROOT_OWNED_PATH).bytes()
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, ROOT_OWNED_PATH, content, { user: "root" })).toMatchObject({ changed: false })
  })

  it("should pass under sudo, because the command runs as root", async () => {
    const { hostSession } = await createFakeSudoSession("plan")
    const { host: h } = hostSession

    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: "root", sudo: true })).toMatchObject({
      changed: true,
    })
    expect(await fileOrMessage(h, ROOT_OWNED_PATH, "new\n", { sudo: true })).toMatchObject({ changed: true })
  })

  it("should match only a uid for a user with no name", async () => {
    const id = `[ "$1" = -u ] && echo ${FAKE_UID} || exit 1`
    const { host: h } = await createFakeToolSession("plan", { id })

    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: FAKE_UID })).toMatchObject({ changed: true })
    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: "adam" })).toBe(
      "failed to compare the host with what the step wants -> user 'adam' needs sudo: true, because only root can change a file's owner to another user",
    )
  })

  it("should fail when id fails", async () => {
    const { host: h } = await createFakeToolSession("plan", { id: 'echo "id broke" >&2; exit 1' })

    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: FAKE_UID })).toBe(
      "failed to compare the host with what the step wants -> failed to read who runs the step's commands -> exited with code 1: id broke",
    )
  })

  it("should fail when id doesn't print a uid", async () => {
    const { host: h } = await createFakeToolSession("plan", { id: "echo adam" })

    expect(await fileOrMessage(h, await createFilePath(), "a\n", { user: FAKE_UID })).toBe(
      "failed to compare the host with what the step wants -> the user command printed 'adam' instead of the id of the user running it",
    )
  })

  it("should not run id for a new file with no user", async () => {
    const hostSession = await createSession("plan")
    await fileOrMessage(hostSession.host, await createFilePath(), "a\n")

    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual(["file details script"])
  })
})

describe("h.file size limit", () => {
  const LIMIT_BYTES = 10_000_000
  const SPARSE_FILE_BYTES = 1_000_000_000_000

  it.each([
    ["a string", () => "a".repeat(LIMIT_BYTES + 1)],
    ["bytes", () => new Uint8Array(LIMIT_BYTES + 1)],
    ["a Blob", () => new Blob([new Uint8Array(LIMIT_BYTES + 1)])],
  ])("should fail on %s one byte over the limit, and run nothing", async (_, toContent) => {
    const hostSession = await createSession("plan")

    expect(await fileOrMessage(hostSession.host, await createFilePath(), toContent())).toBe(
      "the content given to 'file' is 10 MB, above the 10 MB limit",
    )
    expect(hostSession.stepRecords[0]?.commands).toStrictEqual([])
  })

  // Use a sparse file, because reading it would take far more memory than the test has.
  it("should fail on a large local file without reading it", async () => {
    const localPath = await createFilePath()
    await bun.write(localPath, "")
    await truncate(localPath, SPARSE_FILE_BYTES)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, await createFilePath(), bun.file(localPath))).toBe(
      `local file '${localPath}' is 1 TB, above the 10 MB limit`,
    )
  })

  it("should allow content at the limit", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, await createFilePath(), new Uint8Array(LIMIT_BYTES))).toMatchObject({ changed: true })
  })

  it("should fail on a device without reading it", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, await createFilePath(), bun.file("/dev/zero"))).toBe(
      "local file '/dev/zero' doesn't have a size (is it a file?), so it can't be checked against the 10 MB limit",
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

  // Skip this as root, because root can read every file.
  it.skipIf(isRoot)("should say a file the SSH user can't read needs sudo", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o000)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n")).toBe(
      `failed to compare the host with what the step wants -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
    )
  })
})

/** Returns the mode bits of the file at `filePath`. */
const getMode = async (filePath: string) => (await stat(filePath)).mode % 0o1_0000

describe("h.file in apply", () => {
  it("should write a new file with the default mode, and report it changed", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("apply")
    const result = await fileOrMessage(hostSession.host, filePath, "a\n")

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: true })
    expect(await bun.file(filePath).text()).toBe("a\n")
    expect(await getMode(filePath)).toBe(0o644)
    expect(hostSession.stepRecords[0]?.status).toBe("changed")
  })

  it("should write a new secret file as private", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "token\n", { secret: true })

    expect(await getMode(filePath)).toBe(0o600)
  })

  it("should create the parent directories with the usual permissions", async () => {
    const parent = path.join(await makeTempDir(), "a", "b")
    const filePath = path.join(parent, "app.conf")
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "a\n")

    expect(await bun.file(filePath).text()).toBe("a\n")
    expect((await stat(parent)).mode % 0o100).not.toBe(0)
  })

  it("should replace an existing file and keep its mode", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "old\n")
    await chmod(filePath, 0o640)
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "new\n")

    expect(await bun.file(filePath).text()).toBe("new\n")
    expect(await getMode(filePath)).toBe(0o640)
  })

  it("should change only the mode when the content already matches", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o600)
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "a\n", { mode: "644" })

    expect(await bun.file(filePath).text()).toBe("a\n")
    expect(await getMode(filePath)).toBe(0o644)
  })

  it("should keep the setuid bit of a mode it was given", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "a\n", { mode: "4755" })

    expect(await getMode(filePath)).toBe(0o4755)
  })

  it("should report unchanged on the next apply, and run no write", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "a\n", { mode: "640" })

    const hostSession = await createSession("apply")
    const result = await fileOrMessage(hostSession.host, filePath, "a\n", { mode: "640" })

    expect(result).toStrictEqual({ name: filePath, kind: "file", changed: false })
    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual(["file details script"])
  })

  it.each([
    ["empty content", ""],
    ["bytes that aren't text", new Uint8Array([0, 255, 1, 254, 10, 13])],
    ["a line longer than the base64 wrap", "x".repeat(1000)],
  ])("should write %s exactly", async (_, content) => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, content)

    expect(await bun.file(filePath).bytes()).toStrictEqual(await new Blob([content]).bytes())
  })

  it("should write to a path with spaces and quotes", async () => {
    const filePath = path.join(await makeTempDir(), "it's a file.conf")
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, filePath, "a\n")

    expect(await bun.file(filePath).text()).toBe("a\n")
  })

  it("should leave no temp file behind", async () => {
    const directory = await makeTempDir()
    const { host: h } = await createSession("apply")
    await fileOrMessage(h, path.join(directory, "app.conf"), "a\n")

    expect(await readdir(directory)).toStrictEqual(["app.conf"])
  })

  // Skip this as root, because root can set any group, so `chown` wouldn't fail.
  it.skipIf(isRoot)("should fail without touching the file or leaving a temp file when the write fails", async () => {
    const directory = await makeTempDir()
    const filePath = path.join(directory, "app.conf")
    await bun.write(filePath, "old\n")
    const hostSession = await createSession("apply")
    const message = await fileOrMessage(hostSession.host, filePath, "new\n", { group: getOtherGroupId() })

    expect(message).toStartWith(`failed to run the fix -> failed to write '${filePath}' -> exited with code 1: `)
    expect(await bun.file(filePath).text()).toBe("old\n")
    expect(await readdir(directory)).toStrictEqual(["app.conf"])
  })

  it("should refuse a symlink without writing to it or its target", async () => {
    const targetPath = await createFilePath()
    await bun.write(targetPath, "old\n")
    const filePath = await createFilePath()
    await symlink(targetPath, filePath)
    const hostSession = await createSession("apply")

    expect(await fileOrMessage(hostSession.host, filePath, "new\n")).toBe(
      `failed to compare the host with what the step wants -> '${filePath}' is a symlink, so file won't replace it`,
    )
    expect(hostSession.stepRecords[0]?.commands.map(({ label }) => label)).toStrictEqual(["file details script"])
    expect(await bun.file(targetPath).text()).toBe("old\n")
    expect((await lstat(filePath)).isSymbolicLink()).toBe(true)
  })

  // Use fakes, because `chcon` can exist on a system with SELinux off, and then it fails.
  it("should run the SELinux commands only where they apply, and ignore a failure", async () => {
    const logPath = await createFilePath()
    const failAfterLogging = (name: string) => `echo ${name} >> '${logPath}'\nexit 1`
    const { host: h } = await createFakeToolSession("apply", {
      chcon: failAfterLogging("chcon"),
      restorecon: failAfterLogging("restorecon"),
    })
    const filePath = await createFilePath()

    expect(await fileOrMessage(h, filePath, "a\n")).toMatchObject({ changed: true })
    expect(await fileOrMessage(h, filePath, "b\n")).toMatchObject({ changed: true })

    expect(await bun.file(filePath).text()).toBe("b\n")
    expect(await bun.file(logPath).text()).toBe("restorecon\nchcon\n")
  })

  it("should keep the content out of the record, and label the write", async () => {
    const filePath = await createFilePath()
    const hostSession = await createSession("apply")
    await fileOrMessage(hostSession.host, filePath, "secret token\n", { secret: true })

    const commands = hostSession.stepRecords[0]?.commands
    const encoded = Buffer.from("secret token\n").toString("base64")
    expect(commands?.map(({ label, phase }) => [label, phase])).toStrictEqual([
      ["file details script", "before"],
      ["file write script", "fix"],
      ["file details script", "after"],
    ])
    expect(commands?.[1]?.cmd).toContain("<content as base64>")
    expect(commands?.some(({ cmd }) => cmd.includes(encoded))).toBe(false)
  })

  it("should give a new file the default SELinux label, and keep an existing file's", async () => {
    const newFilePath = await createFilePath()
    const existingFilePath = await createFilePath()
    await bun.write(existingFilePath, "old\n")

    const newFileScript = await getWriteScript(newFilePath)
    const existingFileScript = await getWriteScript(existingFilePath)

    expect(newFileScript).toContain("restorecon")
    expect(newFileScript).not.toContain("chcon")
    expect(existingFileScript).toContain("chcon")
    expect(existingFileScript).not.toContain("restorecon")
  })
})

describe("h.file with sudo", () => {
  it("should run every command through sudo, and keep the record as written", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "old\n")
    const { hostSession, readSudoCalls } = await createFakeSudoSession("apply")

    expect(await fileOrMessage(hostSession.host, filePath, "new\n", { sudo: true })).toMatchObject({ changed: true })

    const commands = hostSession.stepRecords[0]?.commands
    expect(await bun.file(filePath).text()).toBe("new\n")
    expect(commands?.map(({ label }) => label)).toStrictEqual([
      "file details script",
      "file content",
      "user command",
      "file write script",
      "file details script",
    ])
    expect(await readSudoCalls()).toStrictEqual(["-n sh -s", "-n sh -s", "-n sh -s", "-n sh -s", "-n sh -s"])
    expect(commands?.some(({ cmd }) => cmd.includes("sudo"))).toBe(false)
  })

  it("should read through sudo in plan, without writing", async () => {
    const filePath = await createFilePath()
    const { hostSession, readSudoCalls } = await createFakeSudoSession("plan")

    expect(await fileOrMessage(hostSession.host, filePath, "new\n", { sudo: true })).toMatchObject({ changed: true })

    expect(await readSudoCalls()).toStrictEqual(["-n sh -s"])
    expect(await bun.file(filePath).exists()).toBe(false)
  })

  it("should not use sudo without the option", async () => {
    const filePath = await createFilePath()
    const { hostSession, readSudoCalls } = await createFakeSudoSession("apply")

    expect(await fileOrMessage(hostSession.host, filePath, "new\n")).toMatchObject({ changed: true })

    expect(await readSudoCalls()).toStrictEqual([])
  })

  it("should write binary content to a path with a newline intact", async () => {
    const filePath = path.join(await makeTempDir(), "app\nconf")
    const bytes = new Uint8Array([0, 255, 10, 0, 128])
    const { hostSession } = await createFakeSudoSession("apply")

    expect(await fileOrMessage(hostSession.host, filePath, bytes, { sudo: true })).toMatchObject({ changed: true })

    expect(await bun.file(filePath).bytes()).toStrictEqual(bytes)
  })

  it("should fail a sudo that isn't a boolean, and run nothing", async () => {
    const filePath = await createFilePath()
    const { hostSession, readSudoCalls } = await createFakeSudoSession("apply")

    expect(await fileOrMessage(hostSession.host, filePath, "new\n", { sudo: castInvalid("yes") })).toBe(
      `failed to validate the options given to 'file' -> sudo must be boolean (was "yes")`,
    )

    expect(hostSession.stepRecords[0]?.commands).toStrictEqual([])
    expect(hostSession.stepRecords[0]?.status).toBeInstanceOf(Error)
    expect(await readSudoCalls()).toStrictEqual([])
  })

  it("should say why when sudo fails", async () => {
    const filePath = await createFilePath()
    const sudo = "echo 'sudo: a password is required' >&2\nexit 1"
    const { host: h } = await createFakeToolSession("plan", { sudo })

    expect(await fileOrMessage(h, filePath, "new\n", { sudo: true })).toBe(
      `failed to compare the host with what the step wants -> failed to read the details of '${filePath}' -> exited with code 1: sudo: a password is required`,
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

// Print to stdout, because the write sends a validate command's stdout to stderr, so the error still shows it.
const rejectContent = () => "echo 'line 1: bad option'; exit 3"
const checkJsonName = (tempPath: string) => `case ${tempPath} in */app.json) test -s ${tempPath} ;; *) exit 1 ;; esac`
const throwBoom = () => {
  throw new Error("boom")
}

describe("h.file validate", () => {
  it("should write the file when the validate command passes", async () => {
    const filePath = await createFilePath()
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, "a\n", { validate: (tempPath) => `test -s ${tempPath}` })).toMatchObject({
      changed: true,
    })
    expect(await bun.file(filePath).text()).toBe("a\n")
  })

  it("should fail and leave the old file and no temp directory when the validate command fails", async () => {
    const filePath = await createFilePath()
    await bun.write(filePath, "old\n")
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, "new\n", { validate: rejectContent })).toBe(
      `failed to run the fix -> failed to write '${filePath}' -> the validate command 'echo 'line 1: bad option'; exit 3' exited with code 3: line 1: bad option`,
    )
    expect(await bun.file(filePath).text()).toBe("old\n")
    expect(await readdir(path.dirname(filePath))).toStrictEqual(["app.conf"])
  })

  it("should give the temp file the destination's name, extension included, in a path with a space", async () => {
    const filePath = path.join(await makeTempDir(), "with space", "app.json")
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, "{}\n", { validate: checkJsonName })).toMatchObject({ changed: true })
  })

  it("should never run the validate command in plan", async () => {
    const filePath = await createFilePath()
    const marker = `${filePath}.validated`
    const { host: h } = await createSession("plan")

    await fileOrMessage(h, filePath, "a\n", { validate: () => `touch '${marker}'` })

    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should fail in plan when validate returns an empty command", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", "a\n", { validate: () => "" })).toBe(
      "failed to validate the validate command given to 'file' -> must be non-empty",
    )
  })

  it("should fail in plan when validate throws", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", "a\n", { validate: throwBoom })).toBe(
      "failed to call the validate function given to 'file' -> boom",
    )
  })

  it("should fail a validate that isn't a function", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/x", "a\n", castInvalid({ validate: "test -s" }))).toStartWith(
      "failed to validate the options given to 'file' -> validate must be a function",
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
