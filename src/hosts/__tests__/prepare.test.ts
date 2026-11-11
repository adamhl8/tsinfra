import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { UNREACHABLE_TARGET, prepareAndRunHost, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"
import type { Host } from "#session/session.ts"

const doNothing = async () => {
  /* empty */
}

describe("prepareHosts", () => {
  it("should prepare every host in order without running a script", async () => {
    const marker = path.join(await makeTempDir(), "ran")
    const touchMarker = async (h: Host) => {
      await h.read(`touch '${marker}'`)
    }
    const hostEntries = await prepareHosts([
      toLoadedHost("a", host("@local", touchMarker)),
      toLoadedHost("b", host(UNREACHABLE_TARGET, touchMarker)),
      toLoadedHost("c", host("@local", touchMarker)),
    ])

    expect(
      hostEntries.map((hostEntry) => [hostEntry.loadedHost.name, hostEntry.sessionContext !== undefined]),
    ).toStrictEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ])
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should record preparation's commands on the host, and leave the host function's on its steps", async () => {
    const hostRecord = await prepareAndRunHost(
      toLoadedHost(
        "a",
        host("@local", async (h) => {
          await h.read("echo hi")
        }),
      ),
      "apply",
    )

    expect(hostRecord.preparationCommands).toMatchObject([
      { cmd: `printf '%s' "$HOME"`, label: "home directory", output: { exitCode: 0 } },
      { cmd: "id -un", label: "user name", output: { exitCode: 0 } },
    ])
    expect(hostRecord.stepRecords.map(({ commands }) => commands.map(({ cmd }) => cmd))).toStrictEqual([["echo hi"]])
  })

  it("should record the ssh -G a target failed on", async () => {
    const hostRecord = await prepareAndRunHost(toLoadedHost("a", host(UNREACHABLE_TARGET, doNothing)), "apply")

    expect(hostRecord.preparationCommands).toMatchObject([
      { cmd: `ssh -G -T -- '${UNREACHABLE_TARGET}'`, label: "ssh config", output: { exitCode: 255 } },
    ])
    expect(JSON.stringify(hostRecord.preparationCommands)).toContain("hostname contains invalid characters")
  })
})
