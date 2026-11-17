import { describe, expect, it } from "bun:test"
import { mkdir, stat, symlink } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import {
  castInvalid,
  createFakeSudoSession,
  createSession,
  dirOrMessage,
  fileOrMessage,
  getStepRecords,
} from "#__tests__/session.ts"

const COMPARE_ERROR = "failed to compare the host with what the step wants"

/** Returns a path two levels under a new temp directory, so making it needs its parents made too. */
const createNestedPath = async () => path.join(await makeTempDir(), "a", "b")

const isDirectory = async (dirPath: string) => (await stat(dirPath)).isDirectory()

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

  it("should trigger a run that follows it when it makes the directory", async () => {
    const hostSession = await createSession("apply")
    const madeDir = await hostSession.host.dir(await createNestedPath())
    await hostSession.host.run("Restart", "true", { after: [madeDir] })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ name: "Restart", status: "ran" })
  })
})

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

  it("should make a step that needs it wait while it would change", async () => {
    const dirPath = await createNestedPath()
    const hostSession = await createSession("plan")
    const madeDir = await hostSession.host.dir(dirPath)
    await hostSession.host.file(path.join(dirPath, "app.conf"), "a\n", { needs: [madeDir] })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ status: "waiting", waitingOn: [dirPath] })
  })
})

describe("h.dir with something else at the path", () => {
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

  it("should clash with a file on the same path", async () => {
    const dirPath = await makeTempDir()
    const { host: h } = await createSession("apply")
    await dirOrMessage(h, dirPath)

    expect(await fileOrMessage(h, dirPath, "a\n")).toBe(
      "an earlier dir step has the same name, and step names must be unique in a host script",
    )
  })
})
