import { describe, expect, it } from "bun:test"

import { makeTempDir } from "@adamhl8/configs/test"
import { isErr, messageChain } from "ts-explicit-errors"

import { castInvalid, writeFakeTool } from "#core/__tests__/session.ts"
import type { Arch, Platform } from "#core/hosts/prepare/host-details/facts.ts"
import { readArch, readPlatform } from "#core/hosts/prepare/host-details/facts/system.ts"
import { getLocalTransport } from "#core/transport.ts"
import { createShell } from "#core/transport/shell.ts"

/** Returns a shell on this machine whose `uname` is a script with `body`. */
const createShellWithUname = async (body: string) => {
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "uname", body)
  const localTransport = getLocalTransport()
  return createShell(async (cmd) => localTransport(`PATH='${binDir}':"$PATH"\n${cmd}`))
}

/** Returns a shell on this machine whose `uname` prints `kernel` for `-s` and `machine` for `-m`. */
const createUnameShell = async (kernel: string, machine: string) =>
  createShellWithUname(`case "$1" in -s) echo '${kernel}' ;; -m) echo '${machine}' ;; esac`)

describe("readPlatform", () => {
  it.each<[string, Platform]>([
    ["Darwin", "darwin"],
    ["Linux", "linux"],
  ])("should name %p as %p", async (kernel, platform) => {
    const factResult = await readPlatform(await createUnameShell(kernel, "x86_64"))

    expect(factResult).toStrictEqual({ value: platform, warning: undefined })
  })

  it("should pass through a platform it has no name for, with a warning", async () => {
    const factResult = await readPlatform(await createUnameShell("FreeBSD", "amd64"))

    expect(factResult).toStrictEqual({
      value: castInvalid("FreeBSD"),
      warning: { kind: "unknownFact", fact: "platform", value: "FreeBSD" },
    })
  })

  it("should fail when uname can't run", async () => {
    const factResult = await readPlatform(await createShellWithUname("exit 1"))

    expect(isErr(factResult) ? messageChain(factResult) : factResult).toStartWith("failed to read the host's platform")
  })
})

describe("readArch", () => {
  it.each<[string, Arch]>([
    ["x86_64", "amd64"],
    ["amd64", "amd64"],
    ["aarch64", "arm64"],
    ["arm64", "arm64"],
  ])("should name %p as %p", async (machine, arch) => {
    const factResult = await readArch(await createUnameShell("Linux", machine))

    expect(factResult).toStrictEqual({ value: arch, warning: undefined })
  })

  it("should pass through a CPU it has no name for, with a warning", async () => {
    const factResult = await readArch(await createUnameShell("Linux", "armv7l"))

    expect(factResult).toStrictEqual({
      value: castInvalid("armv7l"),
      warning: { kind: "unknownFact", fact: "arch", value: "armv7l" },
    })
  })

  it("should look up only the table's own names, not ones every object has", async () => {
    const factResult = await readArch(await createUnameShell("Linux", "constructor"))

    expect(factResult).toStrictEqual({
      value: castInvalid("constructor"),
      warning: { kind: "unknownFact", fact: "arch", value: "constructor" },
    })
  })
})
