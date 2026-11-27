import { describe, expect, it } from "bun:test"

import { makeTempDir } from "@adamhl8/configs/test"
import { isErr, messageChain } from "ts-explicit-errors"

import { castInvalid, loadTestHost, writeFakeTool } from "#core/__tests__/session.ts"
import type { Arch, Platform } from "#core/hosts/prepare/host-details/facts.ts"
import { readArch, readPlatform } from "#core/hosts/prepare/host-details/facts/system.ts"
import { createPreparationRecorder } from "#core/recorder/preparation-recorder.ts"
import { createHostRecord } from "#core/recorder/records.ts"
import { LOCAL_TARGET, getLocalTransport } from "#core/transport.ts"
import { createShell } from "#core/transport/shell.ts"

/**
 * Returns a fact context on this machine whose `uname` is a script with `body`, and the host record its warnings go on,
 * through a real preparation recorder.
 */
const createUnameContext = async (body: string) => {
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "uname", body)
  const localTransport = getLocalTransport()
  const shell = createShell(async (cmd) => localTransport(`PATH='${binDir}':"$PATH"\n${cmd}`))

  const hostRecord = createHostRecord("a", LOCAL_TARGET)
  const recorder = createPreparationRecorder(hostRecord, loadTestHost().options)
  return { ctx: { shell, recorder }, hostRecord }
}

/** Returns a fact context whose `uname` prints `kernel` for `-s` and `machine` for `-m`. */
const createFakeUnameContext = async (kernel: string, machine: string) =>
  createUnameContext(`case "$1" in -s) echo '${kernel}' ;; -m) echo '${machine}' ;; esac`)

describe("readPlatform", () => {
  it.each<[string, Platform]>([
    ["Darwin", "darwin"],
    ["Linux", "linux"],
  ])("should name %p as %p", async (kernel, platform) => {
    const { ctx, hostRecord } = await createFakeUnameContext(kernel, "x86_64")

    expect(await readPlatform(ctx)).toBe(platform)
    expect(hostRecord.warnings).toStrictEqual([])
  })

  it("should pass through a platform it has no name for, with a warning", async () => {
    const { ctx, hostRecord } = await createFakeUnameContext("FreeBSD", "amd64")

    expect(await readPlatform(ctx)).toBe(castInvalid("FreeBSD"))
    expect(hostRecord.warnings).toStrictEqual([{ kind: "unknownFact", fact: "platform", value: "FreeBSD" }])
  })

  it("should fail when uname can't run", async () => {
    const { ctx } = await createUnameContext("exit 1")
    const platform = await readPlatform(ctx)

    expect(isErr(platform) ? messageChain(platform) : platform).toStartWith("failed to read the host's platform")
  })
})

describe("readArch", () => {
  it.each<[string, Arch]>([
    ["x86_64", "amd64"],
    ["amd64", "amd64"],
    ["aarch64", "arm64"],
    ["arm64", "arm64"],
  ])("should name %p as %p", async (machine, arch) => {
    const { ctx, hostRecord } = await createFakeUnameContext("Linux", machine)

    expect(await readArch(ctx)).toBe(arch)
    expect(hostRecord.warnings).toStrictEqual([])
  })

  it("should pass through a CPU it has no name for, with a warning", async () => {
    const { ctx, hostRecord } = await createFakeUnameContext("Linux", "armv7l")

    expect(await readArch(ctx)).toBe(castInvalid("armv7l"))
    expect(hostRecord.warnings).toStrictEqual([{ kind: "unknownFact", fact: "arch", value: "armv7l" }])
  })

  it("should look up only the table's own names, not ones every object has", async () => {
    const { ctx, hostRecord } = await createFakeUnameContext("Linux", "constructor")

    expect(await readArch(ctx)).toBe(castInvalid("constructor"))
    expect(hostRecord.warnings).toStrictEqual([{ kind: "unknownFact", fact: "arch", value: "constructor" }])
  })
})
