import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { UNREACHABLE_TARGET, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"
import type { Host } from "#session/session.ts"

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

    expect(hostEntries.map((hostEntry) => [hostEntry.loadedHost.name, "hostContext" in hostEntry])).toStrictEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ])
    expect(await bun.file(marker).exists()).toBe(false)
  })
})
