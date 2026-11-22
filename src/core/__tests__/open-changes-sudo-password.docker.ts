import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import os from "node:os"

import bun, { $ } from "bun"

import {
  getFinishedStepRecords,
  getPreparedHome,
  loadHostThatStopsBeforeRun,
  prepareAndRunHost,
} from "#core/__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#core/__tests__/sshd.ts"
import { toSavedStatePath } from "#core/hosts/prepare/host-details/tsinfra-directory.ts"
import type { HostRecord } from "#core/session/recorder/records.ts"
import { closeConnections } from "#core/transport.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"

const toStatuses = (hostRecord: HostRecord) =>
  getFinishedStepRecords(hostRecord).map(({ name, status }) => [name, status])

const getOwner = async (filePath: string) => (await $`stat -c %U ${filePath}`.text()).trim()

beforeAll(async () => {
  await startSshd()
})

afterAll(async () => {
  await closeConnections([SSHD_TARGET])
  await stopSshd()
})

describe("open changes on a host whose sudo needs a password, over ssh", () => {
  it("should write the saved state as the SSH user while the steps run as root", async () => {
    const filePath = "/etc/tsinfra-open-change.conf"
    const restartedPath = "/etc/tsinfra-restarted"
    const { loadedHost, reachRun } = loadHostThatStopsBeforeRun({
      target: SSHD_TARGET,
      hostOptions: { sudo: { password: PASSWORD } },
      change: async (h) => h.file(filePath, "a\n", { sudo: true }),
      runCommand: `sudo touch ${restartedPath}`,
    })
    const savedStatePath = toSavedStatePath(await getPreparedHome(loadedHost), "a")

    const firstRecord = await prepareAndRunHost(loadedHost, "apply")
    const savedStateOwner = await getOwner(savedStatePath)
    reachRun()
    const hostRecord = await prepareAndRunHost(loadedHost, "apply")

    expect(firstRecord.failure?.kind).toBe("host fn")
    expect([savedStateOwner, await getOwner(filePath)]).toStrictEqual([os.userInfo().username, "root"])
    expect(toStatuses(hostRecord)).toStrictEqual([
      [filePath, "resume"],
      ["Restart", "ranFromOpenChanges"],
    ])
    expect(await getOwner(restartedPath)).toBe("root")
    expect(await bun.file(savedStatePath).exists()).toBe(false)
    expect(JSON.stringify([firstRecord, hostRecord])).not.toContain(PASSWORD)
  })
})
