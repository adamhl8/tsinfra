import { chmod, copyFile } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostDefinition, HostOptions } from "#hosts/host.ts"
import { host, hostDefinitionSchema } from "#hosts/host.ts"
import type { LoadedHost } from "#hosts/load.ts"
import { prepareHosts, runHost } from "#hosts/run.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import type { Host, HostContext } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"
import type { Transport } from "#transport/transport.ts"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

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

/** Prepares one host the way a run does, and returns its context, or why it couldn't be prepared. */
export const prepareHostContext = async (loadedHost: LoadedHost): Promise<Result<HostContext>> => {
  const hostEntry = await prepareHostEntry(loadedHost)
  return "failure" in hostEntry ? hostEntry.failure : hostEntry.hostContext
}

/** Prepares a host 'a' on `@local`. */
export const buildLocalHostContext = async (hostOptions?: HostOptions) =>
  prepareHostContext(toLoadedHost("a", host("@local", doNothing, hostOptions)))

/** Creates a session for a host 'a' on `@local`. */
export const createSession = async (mode: Mode = "apply", hostOptions?: HostOptions) => {
  const hostContext = await buildLocalHostContext(hostOptions)
  if (isErr(hostContext)) throw hostContext

  return createHostSession(hostContext, mode)
}

/** Writes a shell script named `name` into `binDir`, to stand in for a command on `PATH`. */
export const writeFakeTool = async (binDir: string, name: string, body: string) => {
  const toolPath = path.join(binDir, name)
  await bun.write(toolPath, `#!/bin/sh\n${body}\n`)
  await chmod(toolPath, 0o755)
}

/** Creates a session where the scripts in `binDir` come first on `PATH`. */
const createSessionWithBinDir = async (mode: Mode, binDir: string) => {
  const hostContext = await buildLocalHostContext()
  if (isErr(hostContext)) throw hostContext

  const transport: Transport = async (cmd) => hostContext.transport(`PATH='${binDir}':"$PATH"\n${cmd}`)
  return createHostSession({ ...hostContext, transport }, mode)
}

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
  const failure = hostSession.getFailure()
  return failure && messageChain(failure)
}
