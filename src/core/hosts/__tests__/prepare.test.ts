import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { messageChain } from "ts-explicit-errors"

import {
  getPreparationFailure,
  loadHostDefinition,
  prepareAndRunHost,
  UNREACHABLE_TARGET,
} from "#core/__tests__/session.ts"
import { host } from "#core/hosts/host.ts"
import type { LoadedHost } from "#core/hosts/load.ts"
import { finishHosts, initializeHosts } from "#core/hosts/prepare.ts"
import { toSavedStatePath } from "#core/hosts/prepare/tsinfra-directory.ts"
import { getFinishedStepRecords } from "#core/recorder/records/step.ts"
import type { Host } from "#core/session.ts"

const doNothing = async () => {
  /* empty */
}

/** Prepares `loadedHost` alone, and returns its entry. */
const prepareOne = async (loadedHost: LoadedHost) => {
  const hostInitializations = await initializeHosts([loadedHost])
  const [hostEntry] = await finishHosts(hostInitializations)
  if (!hostEntry) throw new Error("finishHosts returned no host")
  return hostEntry
}

/** Prepares `loadedHost` alone, and returns its prepared entry, or throws why it couldn't be prepared. */
const preparePreparedHost = async (loadedHost: LoadedHost) => {
  const hostEntry = await prepareOne(loadedHost)
  if (hostEntry.preparation === "failed") throw getPreparationFailure(hostEntry.hostRecord)

  return hostEntry
}

const createLocalHost = () => loadHostDefinition(host({ name: "a", target: "@local" }, doNothing))

describe("initializeHosts and finishHosts", () => {
  it("should prepare every host in order without running a script", async () => {
    const marker = path.join(await makeTempDir(), "ran")
    const touchMarker = async (h: Host) => {
      await h.read(`touch '${marker}'`)
    }
    const hostInitializations = await initializeHosts([
      loadHostDefinition(host({ name: "a", target: "@local" }, touchMarker)),
      loadHostDefinition(host({ name: "b", target: UNREACHABLE_TARGET }, touchMarker)),
      loadHostDefinition(host({ name: "c", target: "@local" }, touchMarker)),
    ])
    const hostEntries = await finishHosts(hostInitializations)

    expect(hostEntries.map(({ preparation, hostRecord }) => [hostRecord.name, preparation])).toStrictEqual([
      ["a", "prepared"],
      ["b", "failed"],
      ["c", "prepared"],
    ])
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should record preparation's commands on the host, and leave the host function's on its steps", async () => {
    const hostRecord = await prepareAndRunHost(
      loadHostDefinition(
        host({ name: "a", target: "@local" }, async (h) => {
          await h.read("echo hi")
        }),
      ),
      "apply",
    )

    expect(hostRecord.preparationCommands).toMatchObject([
      { cmd: `printf '%s' "$HOME"`, label: "home directory", output: { exitCode: 0 } },
      { cmd: "uname -s", output: { exitCode: 0 } },
      { cmd: "uname -m", output: { exitCode: 0 } },
      { label: "os-release", output: { exitCode: 0 } },
      { cmd: "id -un", label: "user name", output: { exitCode: 0 } },
    ])
    expect(getFinishedStepRecords(hostRecord).map(({ commands }) => commands.map(({ cmd }) => cmd))).toStrictEqual([
      ["echo hi"],
    ])
  })

  it("should record the ssh -G a target failed on", async () => {
    const hostRecord = await prepareAndRunHost(
      loadHostDefinition(host({ name: "a", target: UNREACHABLE_TARGET }, doNothing)),
      "apply",
    )

    expect(hostRecord.preparationCommands).toMatchObject([
      { cmd: `ssh -G -T -- '${UNREACHABLE_TARGET}'`, label: "ssh config", output: { exitCode: 255 } },
    ])
    expect(JSON.stringify(hostRecord.preparationCommands)).toContain("hostname contains invalid characters")
  })
})

describe("initializeHosts and finishHosts with saved state", () => {
  it("should read no saved state for a host with none, and keep the read off preparation's record", async () => {
    const { sessionSetup, hostRecord } = await preparePreparedHost(createLocalHost())

    expect(sessionSetup.savedStateManager.isOpen("Caddyfile")).toBe(false)
    expect(hostRecord.preparationCommands.some(({ cmd }) => cmd.includes(".tsinfra/state"))).toBe(false)
  })

  it("should read the saved state an earlier preparation of the host left", async () => {
    const loadedHost = createLocalHost()
    const { sessionSetup: firstContext } = await preparePreparedHost(loadedHost)
    await firstContext.savedStateManager.openChange("Caddyfile")

    const { sessionSetup: secondContext } = await preparePreparedHost(loadedHost)

    expect(secondContext.savedStateManager.isOpen("Caddyfile")).toBe(true)
  })

  it("should fail preparation, naming the file, when the saved state isn't saved state tsinfra wrote", async () => {
    const loadedHost = createLocalHost()
    const { sessionSetup } = await preparePreparedHost(loadedHost)
    const savedStatePath = toSavedStatePath(sessionSetup.facts.home, "a")
    await bun.write(savedStatePath, "{")

    const { hostRecord } = await prepareOne(loadedHost)

    expect(messageChain(getPreparationFailure(hostRecord))).toStartWith(
      `the saved state in '${savedStatePath}' isn't saved state tsinfra wrote -> must be a JSON string (SyntaxError: `,
    )
  })
})
