import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun, { $ } from "bun"

import { getPreparedHome, loadHostThatStopsBeforeRun, prepareAndRunHost } from "#core/__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#core/__tests__/sshd.ts"
import { toSavedStatePath } from "#core/hosts/prepare/host-details/tsinfra-directory.ts"
import type { HostRecord } from "#core/session/recorder/records.ts"
import { closeConnections } from "#core/transport.ts"

const toStatuses = ({ stepRecords }: HostRecord) => stepRecords.map(({ name, status }) => [name, status])

const getMode = async (filePath: string) => (await $`stat -c %a ${filePath}`.text()).trim()

beforeAll(async () => {
  await startSshd()
})

afterAll(async () => {
  await closeConnections([SSHD_TARGET])
  await stopSshd()
})

describe("open changes over ssh", () => {
  it("should create the saved state, then trigger the run on the next apply and close it", async () => {
    const markerPath = path.join(await makeTempDir(), "made")
    const restartedPath = path.join(await makeTempDir(), "restarted")
    const { loadedHost, reachRun } = loadHostThatStopsBeforeRun({
      target: SSHD_TARGET,
      change: async (h) =>
        h.ensure("Make marker", { want: true, check: `test -f '${markerPath}'`, fix: `touch '${markerPath}'` }),
      runCommand: `touch '${restartedPath}'`,
    })
    // Start from a home with no `~/.tsinfra`, because a host without a sudo password never writes the askpass helper.
    const savedStatePath = toSavedStatePath(await getPreparedHome(loadedHost), "a")
    const stateDirectory = path.dirname(savedStatePath)

    const firstRecord = await prepareAndRunHost(loadedHost, "apply")
    const modes = [
      await getMode(path.dirname(stateDirectory)),
      await getMode(stateDirectory),
      await getMode(savedStatePath),
    ]
    reachRun()
    const hostRecord = await prepareAndRunHost(loadedHost, "apply")

    expect(firstRecord.failure?.kind).toBe("host fn")
    expect(modes).toStrictEqual(["700", "700", "600"])
    expect(toStatuses(hostRecord)).toStrictEqual([
      ["Make marker", "resume"],
      ["Restart", "ranFromOpenChanges"],
    ])
    expect(await bun.file(restartedPath).exists()).toBe(true)
    expect(await bun.file(savedStatePath).exists()).toBe(false)
  })
})
