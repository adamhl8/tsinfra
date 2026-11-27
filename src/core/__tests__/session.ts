import { chmod, copyFile } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { HostConfig, HostDefinition } from "#core/hosts/host.ts"
import { host, hostDefinitionSchema } from "#core/hosts/host.ts"
import type { LoadedHost } from "#core/hosts/load.ts"
import { toLoadedHost } from "#core/hosts/load.ts"
import { finishHosts, initializeHosts } from "#core/hosts/prepare.ts"
import { buildHostDetails } from "#core/hosts/prepare/host-details.ts"
import type { HostFacts } from "#core/hosts/prepare/host-details/facts.ts"
import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import { toSavedStatePath } from "#core/hosts/prepare/host-details/tsinfra-directory.ts"
import { runHost } from "#core/hosts/run.ts"
import type { Host, SessionContext } from "#core/session.ts"
import { createHostSession } from "#core/session.ts"
import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import type { WantOf } from "#core/session/handlers/ensure/want.ts"
import type { ReadOptions } from "#core/session/handlers/read.ts"
import type { RunOptions } from "#core/session/handlers/run.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import type { Change } from "#core/session/handlers/shared/change.ts"
import { createPreparationRecorder } from "#core/session/recorder/preparation-recorder.ts"
import type { HostRecord } from "#core/session/recorder/records.ts"
import { createHostRecord } from "#core/session/recorder/records.ts"
import type { FinishedStepRecord, StepRecord } from "#core/session/recorder/records/step.ts"
import { getFinishedStepRecords } from "#core/session/recorder/records/step.ts"
import { createSessionRecorder } from "#core/session/recorder/session-recorder.ts"
import { savedStateFileSchema } from "#core/session/saved-state/schema.ts"
import type { Transport } from "#core/transport.ts"
import { LOCAL_TARGET } from "#core/transport.ts"
import type { Mode } from "#mode.ts"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

/** Returns every step a host recorded, in order: the steps that finished, then the step that failed, if one did. */
export const getStepRecords = (hostRecord: HostRecord): (FinishedStepRecord | StepRecord)[] => {
  const { failure } = hostRecord
  const finishedStepRecords = getFinishedStepRecords(hostRecord)
  return failure?.kind === "step" ? [...finishedStepRecords, failure.stepRecord] : finishedStepRecords
}

/** A target that can't be prepared, because ssh rejects the space in it before it reads any config or connects. */
export const UNREACHABLE_TARGET = "unreachable host"

const doNothing = async () => {
  /* empty */
}

/** Gets an invalid value past the types, as a host script can, because Bun runs it without type-checking. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion - a test passes invalid input on purpose, to reach the runtime check
export const castInvalid = (value: unknown) => value as never

export const throwBoom = () => {
  throw new Error("boom")
}

/** What a test sets on a host besides its name and target, like `sudo`. */
type TestHostOptions = Omit<HostConfig, "name" | "target">

/** Validates `hostDefinition` the way loading a host script does, so it gets the same defaults. */
export const loadHostDefinition = (hostDefinition: HostDefinition): LoadedHost =>
  toLoadedHost(hostDefinitionSchema.assert(hostDefinition))

/**
 * Loads a host 'a' on `target`, `@local` by default. The test preload gives a host the same home each time it's
 * prepared, so a test can run several applies on it.
 */
export const loadTestHost = (target: string = LOCAL_TARGET, hostOptions?: TestHostOptions) =>
  loadHostDefinition(host({ name: "a", target, ...hostOptions }, doNothing))

/** Prepares one host the way a run does. */
const prepareHostEntry = async (loadedHost: LoadedHost) => {
  const hostInitializations = await initializeHosts([loadedHost])
  const [hostEntry] = await finishHosts(hostInitializations)
  if (!hostEntry) throw new Error("finishHosts returned no host")
  return hostEntry
}

/** Returns why preparation failed on a host, which the record of an unprepared host always holds. */
export const getPreparationFailure = (hostRecord: HostRecord): Error => {
  const { failure } = hostRecord
  if (failure?.kind !== "preparation") throw new Error("the host's record has no preparation failure")
  return failure.error
}

/** Prepares one host the way a run does, and returns its context, or why it couldn't be prepared. */
const prepareSessionContext = async (loadedHost: LoadedHost): Promise<Result<SessionContext>> => {
  const hostEntry = await prepareHostEntry(loadedHost)
  return hostEntry.preparation === "prepared" ? hostEntry.sessionContext : getPreparationFailure(hostEntry.hostRecord)
}

/** Prepares a host 'a' on `target`, and returns its context, or why it couldn't be prepared. */
export const buildSessionContextOn = async (target: string, hostOptions?: TestHostOptions) =>
  prepareSessionContext(loadTestHost(target, hostOptions))

/** Prepares a host 'a' on `@local`. */
export const buildLocalSessionContext = async (hostOptions?: TestHostOptions) =>
  buildSessionContextOn(LOCAL_TARGET, hostOptions)

/** A test's view of a prepared host: the `Host` its function would get, and the record its session fills in. */
interface TestSession {
  host: Host
  hostRecord: HostRecord
  /** The SSH user's home the session resolves `~/` with, which the test preload gives each host. */
  home: HomeDirectory
}

/**
 * Returns the open changes in the saved state file of the test host 'a', checked against the schema the read uses, or
 * nothing when there's no file.
 */
export const readOpenChanges = async ({ home }: { home: HomeDirectory }) => {
  const savedStateFile = bun.file(toSavedStatePath(home, "a"))
  if (!(await savedStateFile.exists())) return

  return savedStateFileSchema.assert(await savedStateFile.text()).openChanges
}

/** Prepares one host the way a run does, and returns its entry, or throws why it couldn't be prepared. */
const preparePreparedHostEntry = async (loadedHost: LoadedHost) => {
  const hostEntry = await prepareHostEntry(loadedHost)
  if (hostEntry.preparation === "failed") throw getPreparationFailure(hostEntry.hostRecord)

  const { hostRecord, sessionContext } = hostEntry
  return { hostRecord, sessionContext }
}

/** Prepares `loadedHost` the way a run does, and creates its session. */
export const prepareSession = async (loadedHost: LoadedHost, mode: Mode): Promise<TestSession> => {
  const { sessionContext, hostRecord } = await preparePreparedHostEntry(loadedHost)
  return { host: createHostSession(sessionContext, mode), hostRecord, home: sessionContext.facts.home }
}

/** Creates a session for a host 'a' on `target`. */
export const createSessionOn = async (target: string, mode: Mode, hostOptions?: TestHostOptions) =>
  prepareSession(loadTestHost(target, hostOptions), mode)

/** Creates a session for a host 'a' on `@local`. */
export const createSession = async (mode: Mode = "apply", hostOptions?: TestHostOptions) =>
  createSessionOn(LOCAL_TARGET, mode, hostOptions)

/**
 * Creates a session for a host 'a' on `@local` whose facts have `facts` in place of the real ones, to stand in for a
 * host this machine isn't, like a Linux one.
 */
export const createSessionWithFacts = async (mode: Mode, facts: Partial<HostFacts>): Promise<TestSession> => {
  const { sessionContext, hostRecord } = await preparePreparedHostEntry(loadTestHost())
  const hostFacts = Object.freeze({ ...sessionContext.facts, ...facts })
  return { host: createHostSession({ ...sessionContext, facts: hostFacts }, mode), hostRecord, home: hostFacts.home }
}

/** Writes a shell script named `name` into `binDir`, to stand in for a command on `PATH`. */
export const writeFakeTool = async (binDir: string, name: string, body: string) => {
  const toolPath = path.join(binDir, name)
  await bun.write(toolPath, `#!/bin/sh\n${body}\n`)
  await chmod(toolPath, 0o755)
}

/**
 * Creates a session for a host 'a' on `@local` where each command goes through `wrapTransport` first. Prepares the host
 * the way a run does, then builds its details again for the final transport, because the context holds none. Gives the
 * session a second session recorder on the same record, over the wrapped transport.
 */
export const createWrappedSession = async (
  mode: Mode,
  wrapTransport: (transport: Transport) => Transport,
): Promise<TestSession> => {
  const loadedHost = loadTestHost()
  const { sessionContext, hostRecord } = await preparePreparedHostEntry(loadedHost)

  // Record this second preparation on a recorder of its own, because the session's record already has the first.
  const { name, target, options } = loadedHost
  const preparationRecorder = createPreparationRecorder(createHostRecord(name, target), options)
  const hostDetails = await buildHostDetails(loadedHost, preparationRecorder)
  if (isErr(hostDetails)) throw hostDetails
  if (hostDetails.kind !== "ready") throw new Error("the host needs a sudo password prompt")

  const sessionRecorder = createSessionRecorder(
    hostRecord,
    options,
    wrapTransport(hostDetails.transport),
    sessionContext.meta,
  )
  return {
    host: createHostSession({ ...sessionContext, sessionRecorder }, mode),
    hostRecord,
    home: sessionContext.facts.home,
  }
}

/** Creates a session where the scripts in `binDir` come first on `PATH`. */
const createSessionWithBinDir = async (mode: Mode, binDir: string) =>
  createWrappedSession(mode, (transport) => async (cmd) => transport(`PATH='${binDir}':"$PATH"\n${cmd}`))

/** Creates a session where each of `tools` stands in for a command on `PATH`, by its name and shell script body. */
export const createFakeToolSession = async (mode: Mode, tools: Record<string, string>) => {
  const binDir = await makeTempDir()
  await Promise.all(Object.entries(tools).map(async ([name, body]) => writeFakeTool(binDir, name, body)))

  return createSessionWithBinDir(mode, binDir)
}

/** Creates a session with the fake `sudo` and `id` from `fixtures/`, because a test can't rely on real sudo. */
export const createFakeSudoSession = async (mode: Mode) => {
  const binDir = await makeTempDir()
  await copyFile(path.join(FIXTURES_DIR, "fake-sudo.sh"), path.join(binDir, "sudo"))
  await copyFile(path.join(FIXTURES_DIR, "fake-id.sh"), path.join(binDir, "id"))

  const readSudoCalls = async () => {
    const log = bun.file(path.join(binDir, "sudo.log"))
    return (await log.exists()) ? (await log.text()).trim().split("\n") : []
  }

  return { hostSession: await createSessionWithBinDir(mode, binDir), readSudoCalls }
}

/** Prepares `loadedHost` once, and returns the home its saved state goes under, which later preparations reuse. */
export const getPreparedHome = async (loadedHost: LoadedHost) => {
  const { sessionContext } = await preparePreparedHostEntry(loadedHost)
  return sessionContext.facts.home
}

/** What a test passes to `loadHostThatStopsBeforeRun`. */
interface StopsBeforeRunOptions {
  target: string
  hostOptions?: TestHostOptions
  /** Makes the change the run follows. */
  change: (h: Host) => Promise<ChangeStepResult>
  runCommand: string
}

/**
 * Loads a host 'a' whose first apply makes `change` and then fails before the run after it, like an apply that didn't
 * finish. Later applies reach the run. Returns the host, and a function that lets the applies after it reach the run.
 */
export const loadHostThatStopsBeforeRun = (options: StopsBeforeRunOptions) => {
  const { target, hostOptions, change, runCommand } = options
  let isFirstApply = true
  const loadedHost = loadHostDefinition(
    host({ name: "a", target, ...hostOptions }, async (h) => {
      const changeResult = await change(h)
      if (isFirstApply) throwBoom()
      await h.run("Restart", runCommand, { after: [changeResult] })
    }),
  )

  const reachRun = () => {
    isFirstApply = false
  }
  return { loadedHost, reachRun }
}

/** Prepares one host and runs it, for a test that only cares about its report. */
export const prepareAndRunHost = async (loadedHost: LoadedHost, mode: Mode) =>
  runHost(await prepareHostEntry(loadedHost), mode)

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
export const readOrMessage = async (h: Host, cmd: string, options?: ReadOptions) => {
  const output = await attempt(async () => h.read(cmd, options))
  return isErr(output) ? messageChain(output) : output
}

/** Runs `h.ensure` and returns its result, or the thrown error's message chain. */
export const ensureOrMessage = async <T extends WantOf<T>>(h: Host, options: EnsureOptions<T>) => {
  const result = await attempt(async () => h.ensure("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.file` on `path` and returns its result, or the thrown error's message chain. */
export const fileOrMessage = async (h: Host, ...fileArgs: Parameters<Host["file"]>) => {
  const result = await attempt(async () => h.file(...fileArgs))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.dir` on `path` and returns its result, or the thrown error's message chain. */
export const dirOrMessage = async (h: Host, ...dirArgs: Parameters<Host["dir"]>) => {
  const result = await attempt(async () => h.dir(...dirArgs))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.link` on `path` and returns its result, or the thrown error's message chain. */
export const linkOrMessage = async (h: Host, ...linkArgs: Parameters<Host["link"]>) => {
  const result = await attempt(async () => h.link(...linkArgs))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.run` and returns its result, or the thrown error's message chain. */
export const runOrMessage = async (h: Host, cmd: Change, options: RunOptions) => {
  const result = await attempt(async () => h.run("Make marker", cmd, options))
  return isErr(result) ? messageChain(result) : result
}

/** Returns the message chain of the host's recorded failure, if any. */
export const getFailureMessage = (hostSession: Awaited<ReturnType<typeof createSession>>) => {
  const { failure } = hostSession.hostRecord
  return failure && messageChain(failure.error)
}
