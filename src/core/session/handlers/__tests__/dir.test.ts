import { describe, expect, it } from "bun:test"
import { chmod, chown, mkdir, stat, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import {
  castInvalid,
  createFakeSudoSession,
  createSession,
  dirOrMessage,
  fileOrMessage,
  getStepRecords,
} from "#core/__tests__/session.ts"
import { GROUP_DIRECTORY_MODE } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"

const COMPARE_ERROR = "failed to compare the host with what the step wants"
const isRoot = process.getuid?.() === 0
const { uid, gid, username } = os.userInfo()
// Pick a group the user is in besides their own, so a test can change a directory's group without root.
const otherGroupId = (process.getgroups?.() ?? []).find((groupId) => groupId !== gid)
// Fall back to the user's own group, because the test that uses it is skipped when there's no other.
const changedGroupId = otherGroupId ?? gid

/** Returns a path two levels under a new temp directory, so making it needs its parents made too. */
const createNestedPath = async () => path.join(await makeTempDir(), "a", "b")

const isDirectory = async (dirPath: string) => (await stat(dirPath)).isDirectory()

/** Returns the permission and special bits of what's at `dirPath`, like `0o2750`. */
const getMode = async (dirPath: string) => (await stat(dirPath)).mode % 0o1_0000

/** Makes a directory with `mode`, owned by the user and their own group, so a setgid bit sticks on macOS too. */
const createDirWithMode = async (mode: number) => {
  const dirPath = path.join(await makeTempDir(), "made")
  await mkdir(dirPath)
  await chown(dirPath, uid, gid)
  await chmod(dirPath, mode)
  return dirPath
}

/** Returns a symlink in a new temp directory, pointing at a directory when `hasTarget`, and at nothing otherwise. */
const createSymlink = async (hasTarget: boolean) => {
  const directory = await makeTempDir()
  const linkPath = path.join(directory, "link")
  const target = path.join(directory, "target")
  if (hasTarget) await mkdir(target)
  await symlink(target, linkPath)
  return linkPath
}

const getLabels = (hostSession: Awaited<ReturnType<typeof createSession>>) =>
  getStepRecords(hostSession.hostRecord)[0]?.commands.map(({ label }) => label)

describe("h.dir in plan", () => {
  it("should report a missing directory as an exists row without making it", async () => {
    const dirPath = await createNestedPath()
    const hostSession = await createSession("plan")

    expect(await dirOrMessage(hostSession.host, dirPath)).toMatchObject({ changed: true })
    expect(await bun.file(dirPath).exists()).toBe(false)
    expect(hostSession.hostRecord.stepRecords[0]?.comparisons.before?.values).toMatchObject({
      kind: "record",
      changed: { exists: { got: false, want: true } },
    })
  })
})

describe("h.dir in apply", () => {
  it("should make a missing directory and its parents, and read it again after", async () => {
    const dirPath = await createNestedPath()
    const hostSession = await createSession("apply")

    expect(await dirOrMessage(hostSession.host, dirPath)).toStrictEqual({ name: dirPath, kind: "dir", changed: true })
    expect(await isDirectory(dirPath)).toBe(true)
    expect(getLabels(hostSession)).toStrictEqual([
      "directory details script",
      "directory write script",
      "directory details script",
    ])
  })

  it("should leave an existing directory unchanged", async () => {
    const dirPath = await makeTempDir()
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath)).toStrictEqual({ name: dirPath, kind: "dir", changed: false })
  })

  it("should resolve a leading ~/ under the SSH user's home", async () => {
    const hostSession = await createSession("apply")
    await dirOrMessage(hostSession.host, "~/made")

    expect(await isDirectory(path.join(hostSession.home, "made"))).toBe(true)
  })

  it("should run its scripts through sudo with sudo: true", async () => {
    const dirPath = await createNestedPath()
    const { hostSession, readSudoCalls } = await createFakeSudoSession("apply")
    await dirOrMessage(hostSession.host, dirPath, { sudo: true })

    expect(await isDirectory(dirPath)).toBe(true)
    expect((await readSudoCalls()).length).toBeGreaterThan(0)
  })

  it("should fail when a regular file is where a parent goes", async () => {
    const filePath = path.join(await makeTempDir(), "file")
    await bun.write(filePath, "a\n")
    const dirPath = path.join(filePath, "made")
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath)).toStartWith(
      `failed to run the fix -> failed to write the directory at '${dirPath}' -> exited with code 1`,
    )
  })
})

describe("h.dir refusals", () => {
  it("should fail on a regular file", async () => {
    const filePath = path.join(await makeTempDir(), "file")
    await bun.write(filePath, "a\n")
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, filePath)).toBe(
      `${COMPARE_ERROR} -> '${filePath}' isn't a directory, so dir won't replace it`,
    )
  })

  it.each([
    ["to a directory", true],
    ["to nothing", false],
  ])("should fail on a symlink %s", async (_, hasTarget) => {
    const linkPath = await createSymlink(hasTarget)
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, linkPath)).toBe(
      `${COMPARE_ERROR} -> '${linkPath}' is a symlink, so dir won't replace it`,
    )
  })
})

describe("h.dir mode", () => {
  it("should make a directory with the mode given, and leave its parents the default mode", async () => {
    const dirPath = await createNestedPath()
    const { host: h } = await createSession("apply")
    await dirOrMessage(h, dirPath, { mode: "700" })

    expect(await getMode(dirPath)).toBe(0o700)
    // Check the parent's others bits, because a default mode lets others in, and `700` wouldn't.
    expect((await getMode(path.dirname(dirPath))) % 0o10).not.toBe(0)
  })

  it("should fix a wrong mode", async () => {
    const dirPath = await createDirWithMode(0o700)
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath, { mode: GROUP_DIRECTORY_MODE })).toMatchObject({ changed: true })
    expect(await getMode(dirPath)).toBe(0o750)
  })

  it.each(["750", "rwxr-x---", GROUP_DIRECTORY_MODE] as const)("should match a 750 directory with %s", async (mode) => {
    const dirPath = await createDirWithMode(0o750)
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath, { mode })).toMatchObject({ changed: false })
  })

  it("should clear a setgid bit the mode doesn't have", async () => {
    const dirPath = await createDirWithMode(0o2750)
    const modeBefore = await getMode(dirPath)
    const { host: h } = await createSession("apply")
    await dirOrMessage(h, dirPath, { mode: "750" })

    expect([modeBefore, await getMode(dirPath)]).toStrictEqual([0o2750, 0o750])
  })

  it("should leave the mode alone when it isn't given", async () => {
    const dirPath = await createDirWithMode(0o700)
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath, { user: username })).toMatchObject({ changed: false })
    expect(await getMode(dirPath)).toBe(0o700)
  })
})

describe("h.dir owner", () => {
  it.each([
    ["name", username],
    ["id", uid],
  ])("should match the user given by %s", async (_, user) => {
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, await makeTempDir(), { user })).toMatchObject({ changed: false })
  })

  it.skipIf(otherGroupId === undefined)("should change the group to another of the user's groups", async () => {
    const dirPath = await createDirWithMode(0o755)
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath, { group: changedGroupId })).toMatchObject({ changed: true })
    expect((await stat(dirPath)).gid).toBe(changedGroupId)
  })

  it.skipIf(isRoot)("should refuse another user in plan, before anything is made", async () => {
    const dirPath = await createNestedPath()
    const { host: h } = await createSession("plan")

    expect(await dirOrMessage(h, dirPath, { user: "root" })).toBe(
      `${COMPARE_ERROR} -> user 'root' needs sudo: true, because only root can change a file's owner to another user`,
    )
  })
})

describe("h.dir with other steps", () => {
  it("should make a step that needs it wait while it would change", async () => {
    const dirPath = await createNestedPath()
    const hostSession = await createSession("plan")
    const madeDir = await hostSession.host.dir(dirPath)
    await hostSession.host.file(path.join(dirPath, "app.conf"), "a\n", { needs: [madeDir] })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ status: "waiting", waitingOn: [dirPath] })
  })

  it("should trigger a run that follows it when it makes the directory", async () => {
    const hostSession = await createSession("apply")
    const madeDir = await hostSession.host.dir(await createNestedPath())
    await hostSession.host.run("Restart", "true", { after: [madeDir] })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ name: "Restart", status: "ran" })
  })

  it("should clash with a file on the same path", async () => {
    const dirPath = await makeTempDir()
    const { host: h } = await createSession("apply")
    await dirOrMessage(h, dirPath)

    expect(await fileOrMessage(h, dirPath, "a\n")).toBe(
      "an earlier dir step has the same name, and step names must be unique in a host script",
    )
  })
})

describe("h.dir with invalid input", () => {
  it("should fail a bad option under the step", async () => {
    const hostSession = await createSession("apply")

    expect(await dirOrMessage(hostSession.host, await makeTempDir(), castInvalid({ needs: "a" }))).toStartWith(
      "failed to validate the options given to 'dir' -> needs must be",
    )
    expect(hostSession.hostRecord.failure?.kind).toBe("step")
  })

  it("should fail a relative path", async () => {
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, "relative/dir")).toStartWith("failed to validate the path given to 'dir' -> ")
  })
})
