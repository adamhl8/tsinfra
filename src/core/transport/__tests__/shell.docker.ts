import { describe, expect, it } from "bun:test"

import { getLocalTransport } from "#core/transport.ts"
import { createShell } from "#core/transport/shell.ts"
import { createPasswordlessSudoTransport } from "#core/transport/sudo.ts"

describe("createShell with real sudo", () => {
  it("should set a sudo: true shell's variables inside the root shell, exported, after sudo resets the environment", async () => {
    const shell = createShell(createPasswordlessSudoTransport(getLocalTransport()), {
      sudo: true,
      variables: { V: `a $HOME "b"`, T: "t" },
    })

    expect(await shell.inspect(`printf '%s|' "$(id -u)"; sh -c 'printf "%s|%s" "$V" "$T"'`)).toStrictEqual({
      stdout: `0|a $HOME "b"|t`,
      stderr: "",
      exitCode: 0,
    })
  })
})
