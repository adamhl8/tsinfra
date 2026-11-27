import { describe, expect, it } from "bun:test"
import process from "node:process"

import { castInvalid, createSession } from "#core/__tests__/session.ts"
import type { Arch, Platform } from "#core/hosts/prepare/host-details/facts.ts"

// Give Go's names for the platform and CPU running the tests, which is the host on `@local`.
const GO_PLATFORMS: Partial<Record<NodeJS.Platform, Platform>> = { darwin: "darwin", linux: "linux" }
const GO_ARCHES: Partial<Record<NodeJS.Architecture, Arch>> = { x64: "amd64", arm64: "arm64" }

describe("h.facts", () => {
  it("should name the host's platform and CPU by Go's names, with no warning", async () => {
    const { host: h, hostRecord } = await createSession("plan")

    expect(h.facts.platform).toBe(GO_PLATFORMS[process.platform] ?? castInvalid("unknown"))
    expect(h.facts.arch).toBe(GO_ARCHES[process.arch] ?? castInvalid("unknown"))
    expect(hostRecord.warnings).toStrictEqual([])
  })

  it("should give the SSH user's home first, frozen with the rest", async () => {
    const hostSession = await createSession("plan")
    const { facts } = hostSession.host

    expect(facts.home).toBe(hostSession.home)
    expect(Object.keys(facts)).toStrictEqual(["home", "platform", "arch", "osRelease"])
    expect(Object.isFrozen(facts)).toBe(true)
  })

  it.skipIf(process.platform !== "darwin")("should have no os-release on a host with no os-release file", async () => {
    const { host: h } = await createSession("plan")

    expect(h.facts.osRelease).toBeUndefined()
  })

  // Run on Linux, which the Docker tests cover on Alpine and Debian.
  it.skipIf(process.platform !== "linux")("should read the distribution from os-release", async () => {
    const { host: h } = await createSession("plan")
    const { osRelease } = h.facts
    const isDebian = osRelease?.id === "debian"

    expect(["alpine", "debian"]).toContain(osRelease?.id ?? "")
    expect(osRelease?.idLike).toStrictEqual([])
    expect(typeof osRelease?.versionId).toBe("string")
    expect(typeof osRelease?.prettyName).toBe("string")
    expect(osRelease?.versionCodename === undefined).toBe(!isDebian)
  })
})
