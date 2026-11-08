import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { isErr, messageChain } from "ts-explicit-errors"

import { writeFakeTool } from "#__tests__/session.ts"
import type { HostSudo } from "#hosts/host.ts"
import { resolveHostSudo } from "#session/host-details/host-sudo.ts"
import { createShell } from "#session/shell.ts"
import { runLocal } from "#transport/local.ts"

const PASSWORD = `it's "a" $HOME`

// Stand in for `sudo` with a tool that records its arguments and what it reads from stdin, then succeeds.
const RECORDING_SUDO = String.raw`printf '%s\n' "$*" "$(cat)" >"$(dirname "$0")"/sudo.log`

/**
 * Resolves `sudo` with a fake `sudo` from `sudoBody` first on `PATH`. Returns the result or the error's message chain,
 * and what the fake recorded, if anything.
 */
const resolveWithFakeSudo = async (sudo: HostSudo, sudoBody: string) => {
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "sudo", sudoBody)
  const shell = createShell(async (cmd) => runLocal(`PATH='${binDir}':"$PATH"\n${cmd}`))

  const resolvedSudo = await resolveHostSudo(shell, sudo)
  const sudoLog = bun.file(path.join(binDir, "sudo.log"))
  return {
    result: isErr(resolvedSudo) ? messageChain(resolvedSudo) : resolvedSudo,
    sudoLog: (await sudoLog.exists()) ? await sudoLog.text() : undefined,
  }
}

describe("resolveHostSudo", () => {
  it("should check a password from host() on stdin, and return it", async () => {
    expect(await resolveWithFakeSudo({ password: PASSWORD }, RECORDING_SUDO)).toStrictEqual({
      result: { kind: "password", password: PASSWORD },
      sudoLog: `-k -S -p  true\n${PASSWORD}\n`,
    })
  })

  it("should fail with a password from host() that sudo rejects", async () => {
    const { result } = await resolveWithFakeSudo(
      { password: PASSWORD },
      "echo 'sudo: 1 incorrect password attempt' >&2\nexit 1",
    )

    expect(result).toBe("incorrect sudo password -> exited with code 1: sudo: 1 incorrect password attempt")
  })

  it("should find that a sudo: true host needs no password when passwordless sudo works", async () => {
    const { result } = await resolveWithFakeSudo(true, '[ "$1" = -n ] && exit 0\nexit 1')

    expect(result).toStrictEqual({ kind: "passwordless" })
  })

  it("should not run sudo for a host that doesn't declare it", async () => {
    expect(await resolveWithFakeSudo(false, RECORDING_SUDO)).toStrictEqual({
      result: { kind: "passwordless" },
      sudoLog: undefined,
    })
  })
})
