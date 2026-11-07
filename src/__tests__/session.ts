import { chmod } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { host } from "#hosts/host.ts"
import type { LoadedHost } from "#hosts/load.ts"
import { prepareHost, runHost } from "#hosts/run.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import { buildHostContext } from "#session/host-context.ts"
import type { Host } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"
import type { Transport } from "#transport/transport.ts"

const doNothing = async () => {
  /* empty */
}

/** Gets an invalid value past the types, as a host script can, because Bun runs it without type-checking. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion - a test passes invalid input on purpose, to reach the runtime check
export const castInvalid = (value: unknown) => value as never

export const throwBoom = () => {
  throw new Error("boom")
}

/** Creates a session for a host 'a' on `@local`. */
export const createSession = async (mode: Mode = "apply") => {
  const hostContext = await buildHostContext({ name: "a", ...host("@local", doNothing) })
  if (isErr(hostContext)) throw hostContext

  return createHostSession(hostContext, mode)
}

/** Writes a shell script named `name` into `binDir`, to stand in for a command on `PATH`. */
export const writeFakeTool = async (binDir: string, name: string, body: string) => {
  const toolPath = path.join(binDir, name)
  await Bun.write(toolPath, `#!/bin/sh\n${body}\n`)
  await chmod(toolPath, 0o755)
}

/** Creates a session where each of `tools` stands in for a command on `PATH`, by its name and shell script body. */
export const createFakeToolSession = async (mode: Mode, tools: Record<string, string>) => {
  const binDir = await makeTempDir()
  await Promise.all(Object.entries(tools).map(async ([name, body]) => writeFakeTool(binDir, name, body)))

  const hostContext = await buildHostContext({ name: "a", ...host("@local", doNothing) })
  if (isErr(hostContext)) throw hostContext

  const transport: Transport = async (script) => hostContext.transport(`PATH='${binDir}':"$PATH"\n${script}`)
  return createHostSession({ ...hostContext, transport }, mode)
}

/**
 * Creates a session where `sudo` is a fake on `PATH`, because a test can't rely on real sudo. It logs its arguments,
 * and then runs `sudoBody`, which by default runs the command as the same user, with a fake `id` that reports root.
 */
export const createFakeSudoSession = async (mode: Mode, sudoBody = `TSINFRA_FAKE_ROOT=1 exec "$@"`) => {
  const logPath = path.join(await makeTempDir(), "sudo.log")
  const hostSession = await createFakeToolSession(mode, {
    sudo: `echo "$*" >> '${logPath}'\n[ "$1" = -n ] && shift\n${sudoBody}`,
    id: `[ -n "$TSINFRA_FAKE_ROOT" ] || exec '${Bun.which("id")}' "$@"\n[ "$1" = -u ] && echo 0 || echo root`,
  })

  const readSudoCalls = async () => {
    const log = Bun.file(logPath)
    return (await log.exists()) ? (await log.text()).trim().split("\n") : []
  }

  return { hostSession, readSudoCalls }
}

/** Prepares one host and runs it, for a test that only cares about its report. */
export const prepareAndRunHost = async (loadedHost: LoadedHost, mode: Mode) =>
  runHost(await prepareHost(loadedHost), mode)

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
