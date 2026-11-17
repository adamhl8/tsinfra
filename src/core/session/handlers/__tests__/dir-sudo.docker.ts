import { beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { $ } from "bun"

import { createSession, dirOrMessage } from "#core/__tests__/session.ts"
import type { Host } from "#core/session.ts"
import type { DirOptions } from "#core/session/handlers/dir.ts"
import { GROUP_DIRECTORY_MODE } from "#core/session/handlers/shared/filesystem/mode.ts"

const ROOT_OWNED_DIR = "/etc/tsinfra-docker-dirs"

const getModeAndOwner = async (dirPath: string) => (await $`sudo stat -c '%a %U %G' ${dirPath}`.text()).trim()

/** Runs `h.dir` in a new session, like a later run of the script. */
const applyDir = async (...dirArgs: Parameters<Host["dir"]>) => {
  const { host: h } = await createSession("apply")
  return dirOrMessage(h, ...dirArgs)
}

beforeAll(async () => {
  await $`sudo mkdir -p ${ROOT_OWNED_DIR}`
})

describe("h.dir with real sudo", () => {
  it("should make a root-owned directory and its parents, and be unchanged on the next apply", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/new/made`

    expect(await applyDir(dirPath, { sudo: true })).toMatchObject({ changed: true })
    expect([await getModeAndOwner(path.dirname(dirPath)), await getModeAndOwner(dirPath)]).toStrictEqual([
      "755 root root",
      "755 root root",
    ])
    expect(await applyDir(dirPath, { sudo: true })).toMatchObject({ changed: false })
  })

  it("should give a directory to another user and group with a mode, and be unchanged on the next apply", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/owned`
    const options: DirOptions = { sudo: true, user: "sonarr", group: "sonarr", mode: GROUP_DIRECTORY_MODE }

    expect(await applyDir(dirPath, options)).toMatchObject({ changed: true })
    expect(await getModeAndOwner(dirPath)).toBe("750 sonarr sonarr")
    expect(await applyDir(dirPath, options)).toMatchObject({ changed: false })
  })

  it("should set a setgid bit the mode asks for, along with an owner", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/setgid`

    await applyDir(dirPath, { sudo: true, user: "sonarr", mode: "2750" })

    expect(await getModeAndOwner(dirPath)).toBe("2750 sonarr root")
  })

  it("should fix the owner and mode of an existing root-owned directory", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/existing`
    await $`sudo mkdir -m 700 ${dirPath}`

    expect(await applyDir(dirPath, { sudo: true, user: "sonarr", mode: "750" })).toMatchObject({ changed: true })
    expect(await getModeAndOwner(dirPath)).toBe("750 sonarr root")
  })
})

describe("h.dir without sudo, as a user who could use it", () => {
  it("should refuse a root-owned directory whose mode differs", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/refused-mode`
    await $`sudo mkdir -m 755 ${dirPath}`
    const { host: h } = await createSession("plan")

    expect(await dirOrMessage(h, dirPath, { mode: "750" })).toBe(
      `failed to compare the host with what the step wants -> '${dirPath}' is owned by 'root', so writing it needs sudo: true`,
    )
  })

  it("should fail with a raw error under a directory it can't write", async () => {
    const dirPath = `${ROOT_OWNED_DIR}/refused`
    const { host: h } = await createSession("apply")

    expect(await dirOrMessage(h, dirPath)).toContain(`failed to write the directory at '${dirPath}'`)
  })
})
