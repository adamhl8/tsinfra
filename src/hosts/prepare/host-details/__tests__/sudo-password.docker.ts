import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { $ } from "bun"
import { isErr, messageChain } from "ts-explicit-errors"

import { buildLocalHostContext, createSession, fileOrMessage, readOrMessage } from "#__tests__/session.ts"
import type { HostOptions } from "#hosts/host.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"
const ASKPASS_HELPER_PATH = path.join(os.homedir(), ".tsinfra", "askpass.sh")

/** Prepares a host on `@local` and returns the error's message chain, or `prepared`. */
const prepareOrMessage = async (hostOptions: HostOptions) => {
  const hostContext = await buildLocalHostContext(hostOptions)
  return isErr(hostContext) ? messageChain(hostContext) : "prepared"
}

describe("a user whose sudo needs a password", () => {
  it("should write a root-only file with the password from host(), and keep it off the record", async () => {
    const filePath = "/etc/tsinfra-docker-password.conf"
    const hostSession = await createSession("apply", { sudo: { password: PASSWORD } })

    expect(await fileOrMessage(hostSession.host, filePath, "a\n", { sudo: true })).toMatchObject({ changed: true })
    expect((await $`stat -c %U ${filePath}`.text()).trim()).toBe("root")
    expect(await readOrMessage(hostSession.host, "sudo id -u")).toBe("0")
    expect(existsSync(ASKPASS_HELPER_PATH)).toBe(true)
    expect(JSON.stringify(hostSession.hostRecord)).not.toContain(PASSWORD)
  })

  it("should fail in preparation with only its own message for a wrong password from host()", async () => {
    expect(await prepareOrMessage({ sudo: { password: "wrong" } })).toBe("incorrect sudo password")
  })

  it("should fail in preparation with sudo: true and no password", async () => {
    expect(await prepareOrMessage({ sudo: true })).toBe(
      "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host() -> exited with code 1: sudo: a password is required",
    )
  })
})
