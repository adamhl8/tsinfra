import { chmod, copyFile } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { HostDefinition, HostOptions } from "#hosts/host.ts"
import { host, hostDefinitionSchema } from "#hosts/host.ts"
import type { LoadedHost } from "#hosts/load.ts"
import { buildHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"
import { runHost } from "#hosts/run.ts"
import type { Mode } from "#mode.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { EnsureOptions } from "#session/handlers/ensure/ensure.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import type { Host, SessionContext, HostRecord } from "#session/session.ts"
import {
  createHostRecord,
  createHostSession,
  createPreparationRecorder,
  createSessionRecorder,
} from "#session/session.ts"
import type { Transport } from "#transport/transport.ts"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

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

/** Validates `hostDefinition` the way loading a host script does, so it gets the same defaults. */
export const toLoadedHost = (name: string, hostDefinition: HostDefinition): LoadedHost => ({
  name,
  ...hostDefinitionSchema.assert(hostDefinition),
})

/** Prepares one host the way a run does. */
const prepareHostEntry = async (loadedHost: LoadedHost) => {
  const [hostEntry] = await prepareHosts([loadedHost])
  if (!hostEntry) throw new Error("prepareHosts returned no host")
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
  return hostEntry.sessionContext ?? getPreparationFailure(hostEntry.hostRecord)
}

/** Prepares a host 'a' on `@local`. */
export const buildLocalSessionContext = async (hostOptions?: HostOptions) =>
  prepareSessionContext(toLoadedHost("a", host("@local", doNothing, hostOptions)))

/** A test's view of a prepared host: the `Host` its function would get, and the record its session fills in. */
interface TestSession {
  host: Host
  hostRecord: HostRecord
}

/** Prepares one host the way a run does, and returns its entry, or throws why it couldn't be prepared. */
const preparePreparedHostEntry = async (loadedHost: LoadedHost) => {
  const { hostRecord, sessionContext } = await prepareHostEntry(loadedHost)
  if (!sessionContext) throw getPreparationFailure(hostRecord)
  return { hostRecord, sessionContext }
}

/** Prepares `loadedHost` the way a run does, and creates its session. */
export const prepareSession = async (loadedHost: LoadedHost, mode: Mode): Promise<TestSession> => {
  const { sessionContext, hostRecord } = await preparePreparedHostEntry(loadedHost)
  return { host: createHostSession(sessionContext, mode), hostRecord }
}

/** Creates a session for a host 'a' on `@local`. */
export const createSession = async (mode: Mode = "apply", hostOptions?: HostOptions) =>
  prepareSession(toLoadedHost("a", host("@local", doNothing, hostOptions)), mode)

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
  const loadedHost = toLoadedHost("a", host("@local", doNothing))
  const { sessionContext, hostRecord } = await preparePreparedHostEntry(loadedHost)

  // Record this second preparation on a recorder of its own, because the session's record already has the first.
  const { name, target, options } = loadedHost
  const hostDetails = await buildHostDetails(loadedHost, createPreparationRecorder(createHostRecord(name, target)))
  if (isErr(hostDetails)) throw hostDetails
  if (!("transport" in hostDetails)) throw new Error("the host needs a sudo password prompt")

  const sessionRecorder = createSessionRecorder(hostRecord, options, wrapTransport(hostDetails.transport))
  return { host: createHostSession({ ...sessionContext, sessionRecorder }, mode), hostRecord }
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

/** Prepares one host and runs it, for a test that only cares about its report. */
export const prepareAndRunHost = async (loadedHost: LoadedHost, mode: Mode) =>
  runHost(await prepareHostEntry(loadedHost), mode)

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
export const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
}

/** Runs `h.ensure` and returns its result, or the thrown error's message chain. */
export const ensureOrMessage = async <T extends Want>(h: Host, options: EnsureOptions<T>) => {
  const result = await attempt(async () => h.ensure("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.file` on `path` and returns its result, or the thrown error's message chain. */
export const fileOrMessage = async (h: Host, ...fileArgs: Parameters<Host["file"]>) => {
  const result = await attempt(async () => h.file(...fileArgs))
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
