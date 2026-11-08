import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { isErr, messageChain } from "ts-explicit-errors"

import { writeFakeTool } from "#__tests__/session.ts"
import { resolveHostSudo } from "#session/host-context/host-sudo.ts"
import { runLocal } from "#transport/local.ts"
import type { Transport } from "#transport/transport.ts"

const PASSWORD = `it's "a" $HOME`

/**
 * Resolves `{ password }` with a fake `sudo` from `sudoBody`, under a temp `HOME`, so the helper isn't written to the
 * real one. Runs `sudo echo hi` through the transport it returns, and returns the output or the error's message chain.
 */
const resolveAndRunSudo = async (sudoBody: string) => {
  const home = await makeTempDir()
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "sudo", sudoBody)
  const baseTransport: Transport = async (cmd) => runLocal(`HOME='${home}'\nPATH='${binDir}':"$PATH"\n${cmd}`)

  const transport = await resolveHostSudo(baseTransport, { password: PASSWORD })
  const result = isErr(transport) ? messageChain(transport) : await transport("sudo echo hi")
  return { result, home, binDir }
}

describe("resolveHostSudo with a password", () => {
  it("should check the password on stdin, then give it to the script's sudo through the helper", async () => {
    // Stand in for `sudo` with a tool that records the check's arguments and stdin, and prints what the helper gives
    // the script's own `sudo` call.
    const { result, binDir } = await resolveAndRunSudo(
      [
        String.raw`if [ "$1" = -A ]; then shift; printf 'password: %s\n' "$("$SUDO_ASKPASS")"; exec "$@"; fi`,
        String.raw`printf '%s\n' "$*" "$(cat)" >"$(dirname "$0")"/sudo.log`,
      ].join("\n"),
    )

    expect(result).toStrictEqual({ stdout: `password: ${PASSWORD}\nhi\n`, stderr: "", exitCode: 0 })
    expect(await bun.file(path.join(binDir, "sudo.log")).text()).toBe(`-k -S -p  true\n${PASSWORD}\n`)
  })

  it("should fail with a password sudo rejects, before writing the helper", async () => {
    const { result, home } = await resolveAndRunSudo("echo 'sudo: 1 incorrect password attempt' >&2\nexit 1")

    expect(result).toBe("incorrect sudo password -> exited with code 1: sudo: 1 incorrect password attempt")
    expect(existsSync(path.join(home, ".tsinfra"))).toBe(false)
  })
})
