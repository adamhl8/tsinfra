import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { $ } from "bun"
import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import {
  buildLocalSessionContext,
  buildSessionContextOn,
  createSession,
  createSessionOn,
  fileOrMessage,
  readOrMessage,
} from "#__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#__tests__/sshd.ts"
import type { SessionContext } from "#session/session.ts"
import { closeConnections } from "#transport/transport.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"
const ASKPASS_HELPER_PATH = path.join(os.homedir(), ".tsinfra", "askpass.sh")

/** Returns why preparing a host failed as its message chain, or `prepared`. */
const toPreparationMessage = (sessionContext: Result<SessionContext>) =>
  isErr(sessionContext) ? messageChain(sessionContext) : "prepared"

describe("a user whose sudo needs a password", () => {
  it("should write a root-only file with the password from host(), and keep it off the record", async () => {
    const filePath = "/etc/tsinfra-docker-password.conf"
    const hostSession = await createSession("apply", { sudo: { password: PASSWORD } })

    expect(await fileOrMessage(hostSession.host, filePath, "a\n", { sudo: true })).toMatchObject({ changed: true })
    expect((await $`stat -c %U ${filePath}`.text()).trim()).toBe("root")
    expect(await readOrMessage(hostSession.host, "sudo id -u")).toBe("0")
    expect(existsSync(ASKPASS_HELPER_PATH)).toBe(true)
    expect(JSON.stringify(hostSession.hostRecord)).not.toContain(PASSWORD)
    // Check the stand-in too, so the test can't pass just because nothing was recorded.
    const { preparationCommands } = hostSession.hostRecord
    const passwordCheck = preparationCommands.find(({ label }) => label === "sudo password check")
    expect(passwordCheck?.cmd).toBe(String.raw`printf '%s\n' <sudo password> | sudo -k -S -p '' true`)
  })

  it("should fail in preparation with only its own message for a wrong password from host()", async () => {
    expect(toPreparationMessage(await buildLocalSessionContext({ sudo: { password: "wrong" } }))).toBe(
      "incorrect sudo password",
    )
  })

  it("should fail in preparation with sudo: true and no password", async () => {
    expect(toPreparationMessage(await buildLocalSessionContext({ sudo: true }))).toBe(
      "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host() -> exited with code 1: sudo: a password is required",
    )
  })
})

describe("a user whose sudo needs a password, over ssh", () => {
  beforeAll(async () => {
    await startSshd()
  })

  afterAll(async () => {
    await closeConnections([SSHD_TARGET])
    await stopSshd()
  })

  it("should write a root-only file with the password from host(), and keep it off the record", async () => {
    const filePath = "/etc/tsinfra-docker-password-ssh.conf"
    // Remove the askpass helper an earlier test wrote, so only preparation over ssh can have written it.
    await rm(ASKPASS_HELPER_PATH, { force: true })
    const hostSession = await createSessionOn(SSHD_TARGET, "apply", { sudo: { password: PASSWORD } })

    expect(await fileOrMessage(hostSession.host, filePath, "a\n", { sudo: true })).toMatchObject({ changed: true })
    expect((await $`stat -c %U ${filePath}`.text()).trim()).toBe("root")
    expect(await readOrMessage(hostSession.host, "sudo id -u")).toBe("0")
    expect(existsSync(ASKPASS_HELPER_PATH)).toBe(true)
    expect(JSON.stringify(hostSession.hostRecord)).not.toContain(PASSWORD)
  })

  it("should fail in preparation with only its own message for a wrong password from host()", async () => {
    expect(toPreparationMessage(await buildSessionContextOn(SSHD_TARGET, { sudo: { password: "wrong" } }))).toBe(
      "incorrect sudo password",
    )
  })
})
