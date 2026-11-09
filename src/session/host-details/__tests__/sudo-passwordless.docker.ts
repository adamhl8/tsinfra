import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createSession, prepareAndRunHost, readOrMessage, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"

const ASKPASS_HELPER_PATH = path.join(os.homedir(), ".tsinfra", "askpass.sh")

describe("a user with passwordless sudo", () => {
  it("should pass preflight with sudo: true", async () => {
    const { host: h } = await createSession("plan", { sudo: true })

    expect(await readOrMessage(h, "sudo id -u")).toBe("0")
  })

  it("should pass preflight with any password from host(), because sudo never asks for it", async () => {
    const { host: h } = await createSession("plan", { sudo: { password: "unused" } })

    expect(existsSync(ASKPASS_HELPER_PATH)).toBe(true)
    expect(await readOrMessage(h, "sudo id -u")).toBe("0")
  })

  it("should not hint at the sudo option on a host that sets it", async () => {
    // Print sudo's own line for a missing password, because the hint only reads the command's stderr.
    const hostReport = await prepareAndRunHost(
      toLoadedHost(
        "a",
        host(
          "@local",
          async (h) => {
            await h.read("echo 'sudo: a password is required' >&2; exit 1")
          },
          { sudo: true },
        ),
      ),
      "apply",
    )

    expect(hostReport).toMatchObject({ started: true, failureHints: [] })
  })
})
