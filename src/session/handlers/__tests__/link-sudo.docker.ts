import { beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { $ } from "bun"

import { createSession, linkOrMessage } from "#__tests__/session.ts"
import type { Host } from "#session/session.ts"

const ROOT_OWNED_DIR = "/etc/tsinfra-docker-links"
const TARGET = "/etc/hosts"

// `stat` reads a link itself, not what it points to.
const getOwner = async (filePath: string) => (await $`sudo stat -c '%U %G' ${filePath}`.text()).trim()
const readLinkAsRoot = async (filePath: string) => (await $`sudo readlink ${filePath}`.text()).trim()

/** Runs `h.link` in a new session, like a later run of the script. */
const applyLink = async (...linkArgs: Parameters<Host["link"]>) => {
  const { host: h } = await createSession("apply")
  return linkOrMessage(h, ...linkArgs)
}

beforeAll(async () => {
  await $`sudo mkdir -p ${ROOT_OWNED_DIR}`
})

describe("h.link with real sudo", () => {
  it("should make a root-owned link, and be unchanged on the next apply", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/new`

    expect(await applyLink(linkPath, TARGET, { sudo: true })).toMatchObject({ changed: true })
    expect(await getOwner(linkPath)).toBe("root root")
    expect(await readLinkAsRoot(linkPath)).toBe(TARGET)
    expect(await applyLink(linkPath, TARGET, { sudo: true })).toMatchObject({ changed: false })
  })

  it("should give a link to another user without touching its target, and keep them on an update", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/owned`

    await applyLink(linkPath, TARGET, { sudo: true, user: "sonarr", group: "sonarr" })
    expect(await getOwner(linkPath)).toBe("sonarr sonarr")
    expect(await getOwner(TARGET)).toBe("root root")

    await applyLink(linkPath, "/etc/passwd", { sudo: true })
    expect(await getOwner(linkPath)).toBe("sonarr sonarr")
    expect(await readLinkAsRoot(linkPath)).toBe("/etc/passwd")
  })

  it("should change only the owner when the target is already right", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/owner-only`
    await applyLink(linkPath, TARGET, { sudo: true })

    expect(await applyLink(linkPath, TARGET, { sudo: true, user: "sonarr" })).toMatchObject({ changed: true })
    expect((await getOwner(linkPath)).split(" ")[0]).toBe("sonarr")
  })

  // Cover both kinds of new target, because busybox's `mv -T` only replaces this link with another link to a directory.
  it.each([
    ["a file", "/etc/hosts"],
    ["a directory", "/etc"],
  ])("should replace a link to a directory with a link to %s, without following it", async (targetKind, target) => {
    const linkPath = `${ROOT_OWNED_DIR}/to-directory-${targetKind.replace(" ", "-")}`
    const directory = `${linkPath}-old`
    await $`sudo mkdir -p ${directory}`
    await $`sudo ln -s ${directory} ${linkPath}`

    expect(await applyLink(linkPath, target, { sudo: true })).toMatchObject({ changed: true })

    expect(await readLinkAsRoot(linkPath)).toBe(target)
    expect((await $`sudo ls -A ${directory}`.text()).trim()).toBe("")
  })

  it("should replace a root-owned file and keep its owner, with force", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/file`
    await $`sudo sh -c ${`echo old > ${linkPath} && chown sonarr:sonarr ${linkPath}`}`

    await applyLink(linkPath, TARGET, { sudo: true, force: true })

    expect(await readLinkAsRoot(linkPath)).toBe(TARGET)
    expect(await getOwner(linkPath)).toBe("sonarr sonarr")
  })

  it("should leave nothing behind when the write fails", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/failed`

    expect(await applyLink(linkPath, TARGET, { sudo: true, user: "nosuchuser" })).toContain(
      `failed to write the link at '${linkPath}'`,
    )

    const names = await $`sudo ls -A ${ROOT_OWNED_DIR}`.text()
    expect(names.split("\n").filter((name) => name.includes(".tsinfra."))).toStrictEqual([])
  })
})

describe("h.link without sudo, as a user who could use it", () => {
  it("should refuse another user", async () => {
    const linkPath = path.join(await makeTempDir(), "link")
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, linkPath, TARGET, { user: "sonarr" })).toBe(
      "failed to compare the host with what the step wants -> user 'sonarr' needs sudo: true, because only root can change a file's owner to another user",
    )
  })

  it("should refuse a link someone else owns", async () => {
    const linkPath = path.join(await makeTempDir(), "link")
    await $`sudo ln -s /old ${linkPath}`
    const { host: h } = await createSession("plan")

    expect(await linkOrMessage(h, linkPath, TARGET)).toBe(
      `failed to compare the host with what the step wants -> '${linkPath}' is owned by 'root', so writing it needs sudo: true`,
    )
  })

  it("should fail with a raw error under a directory it can't write", async () => {
    const linkPath = `${ROOT_OWNED_DIR}/refused`
    const { host: h } = await createSession("apply")

    expect(await linkOrMessage(h, linkPath, TARGET)).toContain(`failed to write the link at '${linkPath}'`)
  })
})
