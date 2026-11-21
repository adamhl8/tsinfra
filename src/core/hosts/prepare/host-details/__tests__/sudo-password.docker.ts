import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun, { $ } from "bun"
import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import {
  buildLocalSessionContext,
  buildSessionContextOn,
  createSession,
  createSessionOn,
  fileOrMessage,
  readOrMessage,
} from "#core/__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#core/__tests__/sshd.ts"
import type { Host, SessionContext } from "#core/session.ts"
import { closeConnections } from "#core/transport.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"
// Find the helper in the real home, because preparation writes it before the test preload swaps the session's `home`.
const ASKPASS_HELPER_PATH = path.join(os.homedir(), ".tsinfra", "askpass.sh")

// Print the password from a variable the step sets, like the helper in the recipe for a program that runs sudo itself.
const APP_ASKPASS_HELPER = String.raw`#!/bin/sh
printf '%s\n' "$APP_SUDO_PASSWORD"
`
// Run sudo in a shell of its own, which doesn't see tsinfra's `sudo` function, the way a program's own sudo doesn't.
// Use `-k`, so sudo ignores cached credentials and has to run the helper.
const OWN_SUDO_COMMAND = "sh -c 'sudo -k id -u'"

/** Writes the recipe's helper, and returns the options that point a program's own sudo at it, plus `env`. */
const writeAppAskpassHelper = async (h: Host, env: Record<string, string> = {}) => {
  const helperPath = path.join(await makeTempDir(), "app-askpass")
  await h.file(helperPath, APP_ASKPASS_HELPER, { mode: "755" })
  const { sudoPassword = "" } = h.meta

  return { env: { SUDO_ASKPASS: helperPath, ...env }, secretEnv: { APP_SUDO_PASSWORD: sudoPassword } }
}

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

  it("should give the script the password from host() in h.meta, and mask it from the start", async () => {
    const { host: h, hostRecord } = await createSession("apply", { sudo: { password: PASSWORD } })

    expect(h.meta.sudoPassword).toBe(PASSWORD)
    // Print the password through `env`, which masks nothing, so only the masking from the start can hide it.
    expect(await readOrMessage(h, 'printf "%s" "$PASSWORD"', { env: { PASSWORD } })).toBe(PASSWORD)
    expect(JSON.stringify(hostRecord)).not.toContain(PASSWORD)
    expect(hostRecord.stepRecords[0]?.commands[0]?.output).toMatchObject({ stdout: "[MASKED]" })
  })

  it("should leave the sudo password out of h.meta when it's logged, spread, or stringified", async () => {
    const { host: h } = await createSession("apply", { sudo: { password: PASSWORD } })

    expect(bun.inspect(h.meta)).not.toContain(PASSWORD)
    expect(Object.keys({ ...h.meta })).toStrictEqual(["name"])
    expect(JSON.stringify(h.meta)).not.toContain(PASSWORD)
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

  it("should give a program's own sudo the password through SUDO_ASKPASS once DISPLAY is set", async () => {
    const { host: h } = await createSession("apply", { sudo: { password: PASSWORD } })
    const askpassOptions = await writeAppAskpassHelper(h, { DISPLAY: ":0" })

    expect(await readOrMessage(h, OWN_SUDO_COMMAND, askpassOptions)).toBe("0")
  })

  it("should fail a program's own sudo without DISPLAY, because it has no terminal to prompt on", async () => {
    const { host: h } = await createSession("apply", { sudo: { password: PASSWORD } })
    const askpassOptions = await writeAppAskpassHelper(h)

    expect(await readOrMessage(h, OWN_SUDO_COMMAND, askpassOptions)).toContain(
      "sudo: a terminal is required to read the password",
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
