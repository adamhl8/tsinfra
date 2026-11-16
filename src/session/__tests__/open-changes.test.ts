import { describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { createSession, getStepRecords, loadTestHost, prepareSession, readOpenChanges } from "#__tests__/session.ts"
import type { LoadedHost } from "#hosts/load.ts"
import type { HomeDirectory } from "#hosts/prepare/host-details/host-details.ts"
import { toSavedStatePath } from "#hosts/prepare/host-details/host-details.ts"
import type { Mode } from "#mode.ts"
import type { EnsureOptions } from "#session/handlers/ensure/ensure.ts"
import type { HostRecord } from "#session/session.ts"

/** Returns an `ensure` that makes `marker`, so it changes the first time it runs. */
const makeMarker = (marker: string): EnsureOptions<boolean> => ({
  want: true,
  check: `test -f '${marker}'`,
  fix: `touch '${marker}'`,
})

const createMarkerPath = async () => path.join(await makeTempDir(), "made")

/** Loads a test host, and returns it with an `ensure` that changes the first time it runs on it. */
const loadHostWithMarker = async () => ({ loadedHost: loadTestHost(), marker: makeMarker(await createMarkerPath()) })

/** Returns the record of the step named `stepName`, the failed step's included, or nothing when it never ran. */
const getStepRecord = ({ hostRecord }: { hostRecord: HostRecord }, stepName: string) =>
  getStepRecords(hostRecord).find(({ name }) => name === stepName)

/** Returns the status the step named `stepName` finished with, or nothing when it didn't finish. */
const getStatus = ({ hostRecord }: { hostRecord: HostRecord }, stepName: string) =>
  hostRecord.stepRecords.find(({ name }) => name === stepName)?.status

/** Runs `step` and returns what it failed with, as its message chain, or `succeeded`. */
const getStepFailure = async (step: () => Promise<unknown>) => {
  const stepResult = await attempt(step)
  return isErr(stepResult) ? messageChain(stepResult) : "succeeded"
}

/** Runs `Restart` after `Make marker`, in a new session on `loadedHost` that an apply already made the marker on. */
const restartAfterMarker = async (loadedHost: LoadedHost, mode: Mode, marker: EnsureOptions<boolean>, cmd = "true") => {
  const hostSession = await prepareSession(loadedHost, mode)
  const madeMarker = await hostSession.host.ensure("Make marker", marker)
  await getStepFailure(async () => hostSession.host.run("Restart", cmd, { after: [madeMarker] }))
  return getStepRecord(hostSession, "Restart")
}

/** Puts a file where the test host's state directory goes, so a write's `mkdir -p` fails, and returns the file's path. */
const breakStateDirectory = async (home: HomeDirectory) => {
  const savedStatePath = toSavedStatePath(home, "a")
  const stateDirectory = path.dirname(savedStatePath)
  await mkdir(path.dirname(stateDirectory), { recursive: true })
  await bun.write(stateDirectory, "")
  return savedStatePath
}

describe("open changes in apply", () => {
  it("should write nothing in plan", async () => {
    const hostSession = await createSession("plan")
    const marker = await hostSession.host.ensure("Make marker", makeMarker(await createMarkerPath()))
    await hostSession.host.run("Restart", "true", { after: [marker] })

    expect(await readOpenChanges(hostSession)).toBeUndefined()
  })

  it("should open a change before a fix, and record a run that follows it", async () => {
    const hostSession = await createSession("apply")
    const marker = await hostSession.host.ensure("Make marker", makeMarker(await createMarkerPath()))
    await hostSession.host.run("Restart", "true", { after: [marker] })

    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": ["Restart"], Restart: [] })
  })

  it("should leave a failed run open, and off the steps it follows", async () => {
    const hostSession = await createSession("apply")
    const marker = await hostSession.host.ensure("Make marker", makeMarker(await createMarkerPath()))
    await getStepFailure(async () => hostSession.host.run("Restart", "exit 1", { after: [marker] }))

    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": [], Restart: [] })
  })

  it("should open a change with verify off", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Make marker", { ...makeMarker(await createMarkerPath()), verify: false })

    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": [] })
  })

  it("should open an always run's change, and record it on no other step", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Make marker", makeMarker(await createMarkerPath()))
    await hostSession.host.run("Prune", "true", { after: "always" })

    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": [], Prune: [] })
  })

  it("should open a file's and a link's change by their paths", async () => {
    const directory = await makeTempDir()
    const filePath = path.join(directory, "app.conf")
    const linkPath = path.join(directory, "app.link")
    const hostSession = await createSession("apply")
    await hostSession.host.file(filePath, "a\n")
    await hostSession.host.link(linkPath, filePath)

    expect(await readOpenChanges(hostSession)).toStrictEqual({ [filePath]: [], [linkPath]: [] })
  })

  it("should fail a step before its fix when its change can't open", async () => {
    const markerPath = await createMarkerPath()
    const hostSession = await createSession("apply")
    const savedStatePath = await breakStateDirectory(hostSession.home)

    expect(
      await getStepFailure(async () => hostSession.host.ensure("Make marker", makeMarker(markerPath))),
    ).toStartWith(`failed to write the saved state to '${savedStatePath}' -> `)
    expect(await bun.file(markerPath).exists()).toBe(false)
  })

  it("should fail a run before its command when its change can't open", async () => {
    const markerPath = await createMarkerPath()
    const hostSession = await createSession("apply")
    const savedStatePath = await breakStateDirectory(hostSession.home)

    expect(
      await getStepFailure(async () => hostSession.host.run("Restart", `touch '${markerPath}'`, { after: "always" })),
    ).toStartWith(`failed to write the saved state to '${savedStatePath}' -> `)
    expect(await bun.file(markerPath).exists()).toBe(false)
  })

  it("should fail a run after its command when recording it fails", async () => {
    const commandMarkerPath = await createMarkerPath()
    const hostSession = await createSession("apply")
    const marker = await hostSession.host.ensure("Make marker", makeMarker(await createMarkerPath()))
    const savedStatePath = toSavedStatePath(hostSession.home, "a")
    const stateDirectory = path.dirname(savedStatePath)
    // Break the state directory from inside the run's command, after its own change opened, so only the record fails.
    const breakThenMark = `rm -rf '${stateDirectory}' && touch '${stateDirectory}' '${commandMarkerPath}'`

    expect(
      await getStepFailure(async () => hostSession.host.run("Restart", breakThenMark, { after: [marker] })),
    ).toStartWith(`failed to write the saved state to '${savedStatePath}' -> `)
    expect(await bun.file(commandMarkerPath).exists()).toBe(true)
  })
})

describe("changes still open from an earlier apply", () => {
  it.each(["apply", "plan"] as const)("should read an in-sync step as changed in %s", async (mode) => {
    const loadedHost = loadTestHost()
    const marker = makeMarker(await createMarkerPath())
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)
    const hostSession = await prepareSession(loadedHost, mode)

    expect(await hostSession.host.ensure("Make marker", marker)).toStrictEqual({
      name: "Make marker",
      kind: "ensure",
      changed: true,
    })
    expect(hostSession.hostRecord.stepRecords).toMatchObject([
      { name: "Make marker", status: "unchanged", stillOpenFromEarlierApply: true },
    ])
  })

  it("should read a run that didn't trigger as changed", async () => {
    const loadedHost = loadTestHost()
    const marker = makeMarker(await createMarkerPath())
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Reload", "true", { after: "always" })
    const hostSession = await prepareSession(loadedHost, "apply")
    const inSync = await hostSession.host.ensure("Make marker", { ...marker, want: false })

    expect(await hostSession.host.run("Reload", "exit 1", { after: [inSync] })).toStrictEqual({
      name: "Reload",
      kind: "run",
      changed: true,
    })
  })

  it("should not make a step that needs one wait in plan", async () => {
    const loadedHost = loadTestHost()
    const marker = makeMarker(await createMarkerPath())
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)
    const hostSession = await prepareSession(loadedHost, "plan")
    const madeMarker = await hostSession.host.ensure("Make marker", marker)
    await hostSession.host.ensure("Check marker", { want: true, check: "true", fix: "true", needs: [madeMarker] })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ status: "unchanged", waitingOn: [] })
  })

  it("should not flag a step that isn't open", async () => {
    const markerPath = await createMarkerPath()
    await bun.write(markerPath, "")
    const hostSession = await createSession("apply")

    expect(await hostSession.host.ensure("Make marker", makeMarker(markerPath))).toMatchObject({ changed: false })
    expect(hostSession.hostRecord.stepRecords[0]?.stillOpenFromEarlierApply).toBe(false)
  })

  it("should not flag a step that changes again", async () => {
    const loadedHost = loadTestHost()
    const markerPath = await createMarkerPath()
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", makeMarker(markerPath))
    await rm(markerPath)
    const hostSession = await prepareSession(loadedHost, "apply")

    expect(await hostSession.host.ensure("Make marker", makeMarker(markerPath))).toMatchObject({ changed: true })
    expect(hostSession.hostRecord.stepRecords[0]).toMatchObject({ status: "changed" })
    expect(hostSession.hostRecord.stepRecords[0]?.stillOpenFromEarlierApply).toBe(false)
  })
})

describe("runs triggered by open changes", () => {
  it("should trigger a run that failed in an earlier apply", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    const firstApply = await prepareSession(loadedHost, "apply")
    const firstMarker = await firstApply.host.ensure("Make marker", marker)
    await getStepFailure(async () => firstApply.host.run("Restart", "exit 1", { after: [firstMarker] }))
    const hostSession = await prepareSession(loadedHost, "apply")
    await hostSession.host.run("Restart", "true", { after: [await hostSession.host.ensure("Make marker", marker)] })

    expect(getStatus(hostSession, "Restart")).toBe("ran")
    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": ["Restart"], Restart: [] })
  })

  it("should trigger a run an earlier apply never reached", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)
    const hostSession = await prepareSession(loadedHost, "apply")
    await hostSession.host.run("Restart", "true", { after: [await hostSession.host.ensure("Make marker", marker)] })

    expect(getStatus(hostSession, "Restart")).toBe("ran")
  })

  it("should not trigger a run the open change already lists", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Restart", "true", { after: [await firstApply.host.ensure("Make marker", marker)] })
    const hostSession = await prepareSession(loadedHost, "apply")
    await hostSession.host.run("Restart", "true", { after: [await hostSession.host.ensure("Make marker", marker)] })

    expect(getStatus(hostSession, "Restart")).toBe("unchanged")
  })

  it("should trigger only the run an earlier apply didn't reach, of two after one step", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Reload", "true", { after: [await firstApply.host.ensure("Make marker", marker)] })
    const hostSession = await prepareSession(loadedHost, "apply")
    const madeMarker = await hostSession.host.ensure("Make marker", marker)
    await hostSession.host.run("Reload", "true", { after: [madeMarker] })
    await hostSession.host.run("Restart", "true", { after: [madeMarker] })

    expect([getStatus(hostSession, "Reload"), getStatus(hostSession, "Restart")]).toStrictEqual(["unchanged", "ran"])
  })

  it("should trigger a run after a run an earlier apply ran", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Reload", "true", { after: [await firstApply.host.ensure("Make marker", marker)] })
    const hostSession = await prepareSession(loadedHost, "apply")
    const reload = await hostSession.host.run("Reload", "true", {
      after: [await hostSession.host.ensure("Make marker", marker)],
    })
    await hostSession.host.run("Restart", "true", { after: [reload] })

    expect([getStatus(hostSession, "Reload"), getStatus(hostSession, "Restart")]).toStrictEqual(["unchanged", "ran"])
  })

  it("should trigger a run again when its step changes again", async () => {
    const loadedHost = loadTestHost()
    const markerPath = await createMarkerPath()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Restart", "true", {
      after: [await firstApply.host.ensure("Make marker", makeMarker(markerPath))],
    })
    await rm(markerPath)
    const hostSession = await prepareSession(loadedHost, "apply")
    await hostSession.host.run("Restart", "true", {
      after: [await hostSession.host.ensure("Make marker", makeMarker(markerPath))],
    })

    expect(getStatus(hostSession, "Restart")).toBe("ran")
  })

  it("should show a run an open change triggers in plan, without writing", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)
    const hostSession = await prepareSession(loadedHost, "plan")
    await hostSession.host.run("Restart", "true", { after: [await hostSession.host.ensure("Make marker", marker)] })

    expect(getStatus(hostSession, "Restart")).toBe("ran")
    expect(await readOpenChanges(hostSession)).toStrictEqual({ "Make marker": [] })
  })

  it("should not show a run the open change already lists in plan", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Restart", "true", { after: [await firstApply.host.ensure("Make marker", marker)] })
    const hostSession = await prepareSession(loadedHost, "plan")
    await hostSession.host.run("Restart", "true", { after: [await hostSession.host.ensure("Make marker", marker)] })

    expect(getStatus(hostSession, "Restart")).toBe("unchanged")
  })

  it("should show a run in plan when its step drifts again, though the open change lists it", async () => {
    const loadedHost = loadTestHost()
    const markerPath = await createMarkerPath()
    const firstApply = await prepareSession(loadedHost, "apply")
    await firstApply.host.run("Restart", "true", {
      after: [await firstApply.host.ensure("Make marker", makeMarker(markerPath))],
    })
    await rm(markerPath)
    const hostSession = await prepareSession(loadedHost, "plan")
    await hostSession.host.run("Restart", "true", {
      after: [await hostSession.host.ensure("Make marker", makeMarker(markerPath))],
    })

    expect(getStatus(hostSession, "Restart")).toBe("ran")
  })
})

describe("what triggered a run", () => {
  it.each(["apply", "plan"] as const)(
    "should record the still-open changes that alone triggered a run in %s",
    async (mode) => {
      const { loadedHost, marker } = await loadHostWithMarker()
      await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)

      expect(await restartAfterMarker(loadedHost, mode, marker)).toMatchObject({
        triggeringOpenChanges: ["Make marker"],
      })
    },
  )

  it("should keep what triggered a run on its record when it fails", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)

    expect(await restartAfterMarker(loadedHost, "apply", marker, "exit 1")).toMatchObject({
      triggeringOpenChanges: ["Make marker"],
    })
  })

  it("should record nothing when a step changed in this pass, though another's change is still open", async () => {
    const { loadedHost, marker } = await loadHostWithMarker()
    await (await prepareSession(loadedHost, "apply")).host.ensure("Make marker", marker)
    const hostSession = await prepareSession(loadedHost, "apply")
    const madeMarker = await hostSession.host.ensure("Make marker", marker)
    const madeOther = await hostSession.host.ensure("Make other", makeMarker(await createMarkerPath()))
    await hostSession.host.run("Restart", "true", { after: [madeMarker, madeOther] })

    expect(getStepRecord(hostSession, "Restart")).toMatchObject({ status: "ran", triggeringOpenChanges: [] })
  })

  it("should record nothing for an always run, or a run that didn't trigger", async () => {
    const hostSession = await createSession("apply")
    const inSync = await hostSession.host.ensure("Check nothing", { want: true, check: "true", fix: "true" })
    await hostSession.host.run("Prune", "true", { after: "always" })
    await hostSession.host.run("Restart", "true", { after: [inSync] })

    expect([getStepRecord(hostSession, "Prune"), getStepRecord(hostSession, "Restart")]).toMatchObject([
      { status: "ran", triggeringOpenChanges: [] },
      { status: "unchanged", triggeringOpenChanges: [] },
    ])
  })
})
