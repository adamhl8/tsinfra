import { describe, expect, it } from "bun:test"
import { chmod, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises"
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
  getStepRecords,
  linkOrMessage,
  runOrMessage,
} from "#core/__tests__/session.ts"
import { PRIVATE_FILE_MODE, toModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { getFinishedStepRecords } from "#core/session/recorder/records.ts"

const COMPARE_ERROR = "failed to compare the host with what the step wants"
const isRoot = process.getuid?.() === 0

const createPaths = async () => {
  const directory = await makeTempDir()
  return { directory, linkPath: path.join(directory, "link"), target: path.join(directory, "target") }
}

const getLabels = (hostSession: Awaited<ReturnType<typeof createSession>>) =>
  getStepRecords(hostSession.hostRecord)[0]?.commands.map(({ label }) => label)

const getMode = async (filePath: string) => (await stat(filePath)).mode % 0o1_0000

/** Makes a link to a target file with mode 644, like one the step already made. */
const createLinkedTarget = async () => {
  const paths = await createPaths()
  const { linkPath, target } = paths
  await bun.write(target, "a\n")
  await chmod(target, 0o644)
  await symlink(target, linkPath)
  return paths
}

describe("h.link in plan", () => {
  it("should report a new link without making it", async () => {
    const { linkPath, target } = await createPaths()
    await bun.write(target, "a\n")
    const hostSession = await createSession("plan")

    const result = await linkOrMessage(hostSession.host, linkPath, target)

    expect(result).toStrictEqual({ name: linkPath, kind: "link", changed: true })
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toStrictEqual({
      kind: "link",
      linkChange: { kind: "new", want: target },
      ownerChanges: [],
      targetAttributeChanges: [],
      target,
      targetExists: true,
    })
    expect(await readdir(path.dirname(linkPath))).toStrictEqual(["target"])
  })

  it("should be unchanged when the link points at the target", async () => {
    const { linkPath, target } = await createPaths()
    await symlink(target, linkPath)
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, linkPath, target)).toMatchObject({ changed: false })
  })

  it("should report a link that points elsewhere, without changing it", async () => {
    const { linkPath, target } = await createPaths()
    await symlink("/old", linkPath)
    const hostSession = await createSession("plan")

    await linkOrMessage(hostSession.host, linkPath, target)

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      linkChange: { kind: "changed", got: "/old", want: target },
    })
    expect(await readlink(linkPath)).toBe("/old")
  })

  it("should say when the target doesn't exist", async () => {
    const { linkPath, target } = await createPaths()
    const hostSession = await createSession("plan")

    await linkOrMessage(hostSession.host, linkPath, target)

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      targetExists: false,
    })
  })

  it("should report an owner that differs on a link that points at the target", async () => {
    const { linkPath, target } = await createPaths()
    await symlink(target, linkPath)
    const { uid } = os.userInfo()
    const { hostSession } = await createFakeSudoSession("plan")

    await linkOrMessage(hostSession.host, linkPath, target, { user: uid + 1, sudo: true })

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      linkChange: { kind: "same" },
      ownerChanges: [{ name: "user", got: uid, want: uid + 1 }],
    })
  })
})

describe("h.link in apply", () => {
  it("should make a link and create its parent directories", async () => {
    const { directory, target } = await createPaths()
    const linkPath = path.join(directory, "deep", "er", "link")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toStrictEqual({ name: linkPath, kind: "link", changed: true })
    expect(await readlink(linkPath)).toBe(target)
  })

  it("should make a link to a target that doesn't exist yet", async () => {
    const { linkPath, target } = await createPaths()
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target)

    expect(await readlink(linkPath)).toBe(target)
  })

  it("should update a link that points elsewhere", async () => {
    const { linkPath, target } = await createPaths()
    await symlink("/old", linkPath)
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toMatchObject({ changed: true })
    expect(await readlink(linkPath)).toBe(target)
  })

  it("should replace a link to a directory, and leave that directory alone", async () => {
    const { directory, linkPath, target } = await createPaths()
    const oldDirectory = path.join(directory, "old")
    await mkdir(oldDirectory)
    await symlink(oldDirectory, linkPath)
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target)

    expect(await readlink(linkPath)).toBe(target)
    expect(await readdir(oldDirectory)).toStrictEqual([])
  })

  it("should be unchanged on the next apply, and run no write", async () => {
    const { linkPath, target } = await createPaths()
    const { host: h } = await createSession("apply")
    await linkOrMessage(h, linkPath, target)

    const hostSession = await createSession("apply")

    expect(await linkOrMessage(hostSession.host, linkPath, target)).toMatchObject({ changed: false })
    expect(getLabels(hostSession)).toStrictEqual(["link details script"])
  })

  it("should label every command it runs, and write in the fix", async () => {
    const { linkPath, target } = await createPaths()
    const hostSession = await createSession("apply")

    await linkOrMessage(hostSession.host, linkPath, target)

    const commands = getFinishedStepRecords(hostSession.hostRecord)[0]?.commands
    expect(commands?.map(({ label, phase }) => [label, phase])).toStrictEqual([
      ["link details script", "before"],
      ["link write script", "fix"],
      ["link details script", "after"],
    ])
  })

  it("should write to a path and a target with a quote, a space, and a newline", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "it's a\nlink")
    const target = path.join(directory, "it's a\ntarget")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toMatchObject({ changed: true })
    expect(await readlink(linkPath)).toBe(target)

    const next = await createSession("apply")
    expect(await linkOrMessage(next.host, linkPath, target)).toMatchObject({ changed: false })
  })

  it("should leave no temp directory behind", async () => {
    const { directory, linkPath, target } = await createPaths()
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target)

    expect(await readdir(directory)).toStrictEqual(["link"])
  })

  it("should resolve ~/ in the path and the target as the SSH user's home", async () => {
    const directoryName = "tsinfra-never-created"
    const hostSession = await createSession("plan")
    const { uid } = os.userInfo()

    await linkOrMessage(hostSession.host, `~/${directoryName}/link`, "~/target", { user: uid })

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      linkChange: { kind: "new", want: path.join(hostSession.home, "target") },
    })
  })
})

describe("h.link named like the write script's own temp files", () => {
  it.each(["probe", "probed"])("should make a link named '%s' without touching its target", async (name) => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, name)
    const target = path.join(directory, "target")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toMatchObject({ changed: true })
    expect(await readlink(linkPath)).toBe(target)
    expect(await bun.file(target).exists()).toBe(false)
  })
})

describe("h.link replacing something", () => {
  it("should refuse a regular file without force, and leave it alone", async () => {
    const { linkPath, target } = await createPaths()
    await bun.write(linkPath, "old\n")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toBe(
      `${COMPARE_ERROR} -> '${linkPath}' is a regular file, so link won't replace it without force: true`,
    )
    expect(await bun.file(linkPath).text()).toBe("old\n")
  })

  it("should replace a regular file with force", async () => {
    const { linkPath, target } = await createPaths()
    await bun.write(linkPath, "old\n")
    const hostSession = await createSession("apply")

    expect(await linkOrMessage(hostSession.host, linkPath, target, { force: true })).toMatchObject({ changed: true })
    expect(await readlink(linkPath)).toBe(target)
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      linkChange: { kind: "replacesFile", want: target },
    })
  })

  it("should refuse an empty directory without force, and leave it alone", async () => {
    const { linkPath, target } = await createPaths()
    await mkdir(linkPath)
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target)).toBe(
      `${COMPARE_ERROR} -> '${linkPath}' is an empty directory, so link won't replace it without force: true`,
    )
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
  })

  it("should replace an empty directory with force", async () => {
    const { linkPath, target } = await createPaths()
    await mkdir(linkPath)
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target, { force: true })).toMatchObject({ changed: true })
    expect(await readlink(linkPath)).toBe(target)
  })

  it.each([
    ["a visible file", "file"],
    ["a hidden file", ".file"],
  ])("should refuse a directory holding %s, even with force", async (_, fileName) => {
    const { linkPath, target } = await createPaths()
    await bun.write(path.join(linkPath, fileName), "keep\n")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target, { force: true })).toBe(
      `${COMPARE_ERROR} -> '${linkPath}' is a directory with files in it, so link won't replace it`,
    )
    expect(await readdir(linkPath)).toStrictEqual([fileName])
  })

  // Skip this as root, because root can list a directory whatever its mode.
  it.skipIf(isRoot)("should fail on a directory it can't list, instead of calling it empty", async () => {
    const { linkPath, target } = await createPaths()
    await bun.write(path.join(linkPath, "file"), "keep\n")
    await chmod(linkPath, 0o000)
    const { host: h } = await createSession("plan")

    try {
      const message = await linkOrMessage(h, linkPath, target, { force: true })
      expect(message).toStartWith(`${COMPARE_ERROR} -> failed to read the details of '${linkPath}' -> exited with code`)
      expect(message).toContain("Permission denied")
    } finally {
      await chmod(linkPath, 0o755)
    }
  })

  it("should refuse something that isn't a link, a file, or a directory, even with force", async () => {
    const { target } = await createPaths()
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, "/dev/null", target, { force: true })).toBe(
      `${COMPARE_ERROR} -> '/dev/null' isn't a link or a regular file, so link won't replace it`,
    )
  })
})

describe("h.link owner", () => {
  it("should make a link with the user's own name and id", async () => {
    const { username, uid } = os.userInfo()
    const { directory, target } = await createPaths()
    const namePath = path.join(directory, "by-name")
    const idPath = path.join(directory, "by-id")
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, namePath, target, { user: username })).toMatchObject({ changed: true })
    expect(await linkOrMessage(h, idPath, target, { user: uid })).toMatchObject({ changed: true })
    expect((await lstat(namePath)).uid).toBe(uid)
  })

  // Skip this as root, because root can give a link to anyone.
  it.skipIf(isRoot)("should refuse another user without sudo", async () => {
    const { linkPath, target } = await createPaths()
    const hostSession = await createSession("plan")

    expect(await linkOrMessage(hostSession.host, linkPath, target, { user: "root" })).toBe(
      `${COMPARE_ERROR} -> user 'root' needs sudo: true, because only root can change a file's owner to another user`,
    )
    expect(getLabels(hostSession)).toStrictEqual(["link details script", "user command"])
  })

  it("should not read the user for a new link with no user", async () => {
    const { linkPath, target } = await createPaths()
    const hostSession = await createSession("plan")

    await linkOrMessage(hostSession.host, linkPath, target)

    expect(getLabels(hostSession)).toStrictEqual(["link details script"])
  })

  it("should pass under sudo, because the command runs as root", async () => {
    const { linkPath, target } = await createPaths()
    const { hostSession, readSudoCalls } = await createFakeSudoSession("plan")

    expect(await linkOrMessage(hostSession.host, linkPath, target, { user: "root", sudo: true })).toMatchObject({
      changed: true,
    })
    expect(await readSudoCalls()).toStrictEqual(["-n sh -s", "-n sh -s"])
  })
})

describe("h.link with other steps", () => {
  it("should wait in plan on a step it needs, without reading the path", async () => {
    const { directory, linkPath, target } = await createPaths()
    const hostSession = await createSession("plan")
    const needed = await hostSession.host.file(path.join(directory, "needed"), "a\n")

    expect(await linkOrMessage(hostSession.host, linkPath, target, { needs: [needed] })).toMatchObject({
      changed: true,
    })
    expect(getFinishedStepRecords(hostSession.hostRecord)[1]?.status).toBe("waiting")
    expect(getFinishedStepRecords(hostSession.hostRecord)[1]?.commands).toStrictEqual([])
  })

  it("should be a step that another step can need, and a run can follow", async () => {
    const { linkPath, target } = await createPaths()
    const hostSession = await createSession("plan")
    const link = await hostSession.host.link(linkPath, target)

    expect(await runOrMessage(hostSession.host, "true", { after: [link] })).toMatchObject({ changed: true })
    expect(await linkOrMessage(hostSession.host, `${linkPath}2`, target, { needs: [link] })).toMatchObject({
      changed: true,
    })
    expect(getFinishedStepRecords(hostSession.hostRecord)[2]?.status).toBe("waiting")
  })
})

describe("h.link targetAttributes in plan", () => {
  it("should report a target mode that differs, and leave it alone", async () => {
    const { linkPath, target } = await createLinkedTarget()
    const hostSession = await createSession("plan")

    expect(
      await linkOrMessage(hostSession.host, linkPath, target, { targetAttributes: { mode: "600" } }),
    ).toMatchObject({ changed: true })
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      linkChange: { kind: "same" },
      targetAttributeChanges: [{ name: "mode", got: toModeBits(0o644), want: toModeBits(0o600) }],
    })
    expect(await getMode(target)).toBe(0o644)
  })

  it("should be unchanged when the target's mode matches", async () => {
    const { linkPath, target } = await createLinkedTarget()
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "644" } })).toMatchObject({
      changed: false,
    })
  })

  it("should be unchanged with a warning when the target is missing", async () => {
    const { linkPath, target } = await createPaths()
    await symlink(target, linkPath)
    const hostSession = await createSession("plan")

    expect(
      await linkOrMessage(hostSession.host, linkPath, target, { targetAttributes: { mode: "600" } }),
    ).toMatchObject({ changed: false })
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values).toMatchObject({
      targetAttributeChanges: [],
      targetExists: false,
    })
  })
})

describe("h.link targetAttributes in apply", () => {
  it("should set the target's mode, and be unchanged on the next apply with no write", async () => {
    const { linkPath, target } = await createLinkedTarget()
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "600" } })).toMatchObject({
      changed: true,
    })
    expect(await getMode(target)).toBe(0o600)

    const next = await createSession("apply")
    expect(await linkOrMessage(next.host, linkPath, target, { targetAttributes: { mode: "600" } })).toMatchObject({
      changed: false,
    })
    expect(getLabels(next)).toStrictEqual(["link details script"])
  })

  it("should set the target's mode on a new link", async () => {
    const { linkPath, target } = await createPaths()
    await bun.write(target, "a\n")
    await chmod(target, 0o644)
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "600" } })

    expect(await readlink(linkPath)).toBe(target)
    expect(await getMode(target)).toBe(0o600)
  })

  it("should leave a link in sync alone while it sets the target's mode, and run a run after it", async () => {
    const { linkPath, target } = await createLinkedTarget()
    const { ino } = await lstat(linkPath)
    const hostSession = await createSession("apply")
    const link = await hostSession.host.link(linkPath, target, { targetAttributes: { mode: "600" } })

    expect(link.changed).toBe(true)
    expect(await runOrMessage(hostSession.host, "true", { after: [link] })).toMatchObject({ changed: true })
    expect((await lstat(linkPath)).ino).toBe(ino)
  })

  it("should set the mode of the file at the end when the target is itself a link", async () => {
    const { directory, linkPath, target } = await createPaths()
    const filePath = path.join(directory, "file")
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o644)
    await symlink(filePath, target)
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "600" } })

    expect(await getMode(filePath)).toBe(0o600)
    expect(await readlink(target)).toBe(filePath)
  })

  it("should set the mode of a target that's a directory", async () => {
    const { linkPath, target } = await createPaths()
    await mkdir(target, { mode: 0o755 })
    const { host: h } = await createSession("apply")

    await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "rwx------" } })

    expect(await getMode(target)).toBe(0o700)
  })

  it("should treat a mode in octal and the same mode as a constant alike", async () => {
    const { linkPath, target } = await createLinkedTarget()
    const { host: h } = await createSession("apply")
    await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "600" } })

    const next = await createSession("apply")

    expect(
      await linkOrMessage(next.host, linkPath, target, { targetAttributes: { mode: PRIVATE_FILE_MODE } }),
    ).toMatchObject({ changed: false })
  })

  it("should skip a target an earlier step creates in plan, and set it in apply", async () => {
    const { linkPath, target } = await createPaths()
    await symlink(target, linkPath)

    const plan = await createSession("plan")
    await plan.host.file(target, "a\n")
    expect(await linkOrMessage(plan.host, linkPath, target, { targetAttributes: { mode: "600" } })).toMatchObject({
      changed: false,
    })

    const apply = await createSession("apply")
    await apply.host.file(target, "a\n")
    expect(await linkOrMessage(apply.host, linkPath, target, { targetAttributes: { mode: "600" } })).toMatchObject({
      changed: true,
    })
    expect(await getMode(target)).toBe(0o600)
  })
})

describe("h.link targetAttributes on one target from two links", () => {
  it("should pass two links that give a target the same mode, written two ways", async () => {
    const { directory, target } = await createLinkedTarget()
    const { host: h } = await createSession("plan")

    await linkOrMessage(h, path.join(directory, "a"), target, { targetAttributes: { mode: "600" } })

    expect(
      await linkOrMessage(h, path.join(directory, "b"), target, { targetAttributes: { mode: PRIVATE_FILE_MODE } }),
    ).toMatchObject({ changed: true })
  })

  it("should fail the second link that gives a target a different mode, naming the first, even when it waits", async () => {
    const { directory, target } = await createLinkedTarget()
    const firstLink = path.join(directory, "a")
    const hostSession = await createSession("plan")
    const needed = await hostSession.host.file(path.join(directory, "needed"), "a\n")
    await linkOrMessage(hostSession.host, firstLink, target, { targetAttributes: { mode: "600" } })

    expect(
      await linkOrMessage(hostSession.host, path.join(directory, "b"), target, {
        targetAttributes: { mode: "640" },
        needs: [needed],
      }),
    ).toBe(`'${target}' already gets mode '600' from link '${firstLink}', so it can't get '640'`)
  })

  it("should pass two links that set different attributes of one target", async () => {
    const { directory, target } = await createLinkedTarget()
    const { uid } = os.userInfo()
    const { host: h } = await createSession("plan")

    await linkOrMessage(h, path.join(directory, "a"), target, { targetAttributes: { mode: "600" } })

    expect(
      await linkOrMessage(h, path.join(directory, "b"), target, { targetAttributes: { user: uid } }),
    ).toMatchObject({ changed: true })
  })

  it("should pass a link without targetAttributes next to one with them", async () => {
    const { directory, target } = await createLinkedTarget()
    const { host: h } = await createSession("plan")

    await linkOrMessage(h, path.join(directory, "a"), target, { targetAttributes: { mode: "600" } })

    expect(await linkOrMessage(h, path.join(directory, "b"), target)).toMatchObject({ changed: true })
  })

  it("should fail a user given as a name after the same user given as a number", async () => {
    const { directory, target } = await createLinkedTarget()
    const firstLink = path.join(directory, "a")
    const { uid, username } = os.userInfo()
    const { host: h } = await createSession("plan")
    await linkOrMessage(h, firstLink, target, { targetAttributes: { user: uid } })

    expect(await linkOrMessage(h, path.join(directory, "b"), target, { targetAttributes: { user: username } })).toBe(
      `'${target}' already gets user '${uid}' from link '${firstLink}', so it can't get '${username}'`,
    )
  })

  it("should count a target written with ~/ and written out in full as one target", async () => {
    const hostSession = await createSession("plan")
    const { home } = hostSession
    const directory = await makeTempDir()

    await linkOrMessage(hostSession.host, path.join(directory, "a"), "~/target", { targetAttributes: { mode: "600" } })

    expect(
      await linkOrMessage(hostSession.host, path.join(directory, "b"), path.join(home, "target"), {
        targetAttributes: { mode: "640" },
      }),
    ).toBe(
      `'${path.join(home, "target")}' already gets mode '600' from link '${path.join(directory, "a")}', so it can't get '640'`,
    )
  })
})

describe("h.link targetAttributes on a path another step sets", () => {
  it("should fail a link that gives a file step's path a different mode, naming the file step", async () => {
    const { directory, target } = await createPaths()
    const { host: h } = await createSession("plan")
    await h.file(target, "a\n", { mode: "644" })

    expect(await linkOrMessage(h, path.join(directory, "link"), target, { targetAttributes: { mode: "600" } })).toBe(
      `'${target}' already gets mode '644' from file '${target}', so it can't get '600'`,
    )
  })

  it("should fail a dir step that gives a link's target a different mode, naming the link", async () => {
    const { linkPath, target } = await createPaths()
    await mkdir(target)
    const { host: h } = await createSession("plan")
    await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "700" } })

    expect(await dirOrMessage(h, target, { mode: "755" })).toBe(
      `'${target}' already gets mode '700' from link '${linkPath}', so it can't get '755'`,
    )
  })

  it("should pass a file step without a mode next to a link that sets its target's mode", async () => {
    const { linkPath, target } = await createPaths()
    const { host: h } = await createSession("plan")
    await h.file(target, "a\n")

    expect(await linkOrMessage(h, linkPath, target, { targetAttributes: { mode: "600" } })).toMatchObject({
      changed: true,
    })
  })
})

describe("h.link with invalid input", () => {
  it.each(["link", "./link", "~bob/link"])("should refuse the path '%s'", async (linkPath) => {
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, linkPath, "/target")).toBe(
      `failed to validate the path given to 'link' -> must be an absolute path, starting with / or ~/ (was "${linkPath}")`,
    )
  })

  it.each(["target", "./target", "../target", "~bob/target"])("should refuse the target '%s'", async (target) => {
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, "/tmp/link", target)).toBe(
      "failed to validate the target given to 'link' -> must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory",
    )
  })

  it("should refuse a target with a '..' segment", async () => {
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, "/tmp/link", "/etc/../target")).toBe(
      `failed to validate the target given to 'link' -> must be a path without a '..' segment (was "/etc/../target")`,
    )
  })

  it("should fail a target that isn't a string", async () => {
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, "/tmp/link", castInvalid(1))).toBe(
      "failed to validate the target given to 'link' -> must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory",
    )
  })

  it("should fail options that aren't valid", async () => {
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, "/tmp/link", "/target", { force: castInvalid("yes") })).toBe(
      `failed to validate the options given to 'link' -> force must be boolean (was "yes")`,
    )
  })

  it("should fail a target mode that isn't valid", async () => {
    const { host: h } = await createSession("plan")

    expect(
      await linkOrMessage(h, "/tmp/link", "/target", { targetAttributes: castInvalid({ mode: "999" }) }),
    ).toStartWith("failed to validate the options given to 'link' -> targetAttributes.mode must be matched by")
  })
})
