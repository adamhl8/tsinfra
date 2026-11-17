import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { $ } from "bun"

import { createSessionOn, dirOrMessage } from "#__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#__tests__/sshd.ts"
import type { DirOptions, Host } from "#session/session.ts"
import { closeConnections } from "#transport/transport.ts"

const getModeAndOwner = async (dirPath: string) => (await $`sudo stat -c '%a %U %G' ${dirPath}`.text()).trim()

/** Runs `h.dir` over ssh in a new session, like a later run of the script. */
const applyDirOverSsh = async (...dirArgs: Parameters<Host["dir"]>) => {
  const { host: h } = await createSessionOn(SSHD_TARGET, "apply")
  return dirOrMessage(h, ...dirArgs)
}

beforeAll(async () => {
  await startSshd()
})

afterAll(async () => {
  await closeConnections([SSHD_TARGET])
  await stopSshd()
})

describe("h.dir over ssh", () => {
  it("should give a root-owned directory to another user with sudo: true, and be unchanged on the next apply", async () => {
    const dirPath = "/etc/tsinfra-docker-ssh-dir/made"
    const options: DirOptions = { sudo: true, user: "sonarr", mode: "750" }

    expect(await applyDirOverSsh(dirPath, options)).toMatchObject({ changed: true })
    expect(await getModeAndOwner(dirPath)).toBe("750 sonarr root")
    expect(await applyDirOverSsh(dirPath, options)).toMatchObject({ changed: false })
  })
})
