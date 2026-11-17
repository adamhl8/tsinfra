import { describe, expect, it } from "bun:test"

import { getLocalTransport } from "#core/transport.ts"
import { createStepTransport } from "#core/transport/step.ts"
import { createPasswordlessSudoTransport } from "#core/transport/sudo.ts"

describe("createStepTransport with real sudo", () => {
  it("should set a sudo: true step's variables inside the root shell, exported, after sudo resets the environment", async () => {
    const stepTransport = createStepTransport(createPasswordlessSudoTransport(getLocalTransport()), {
      sudo: true,
      variables: { V: `a $HOME "b"`, T: "t" },
    })

    expect(await stepTransport(`printf '%s|' "$(id -u)"; sh -c 'printf "%s|%s" "$V" "$T"'`)).toStrictEqual({
      stdout: `0|a $HOME "b"|t`,
      stderr: "",
      exitCode: 0,
    })
  })
})
