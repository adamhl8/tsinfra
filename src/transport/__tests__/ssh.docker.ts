import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import bun, { $ } from "bun"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { prepareAndRunHost, prepareHostContext, readOrMessage, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { createHostSession } from "#session/session.ts"
import { closeConnections, getTransport } from "#transport/transport.ts"

// `setup.sh` points `tsinfra-sshd` at the sshd this file starts, and `tsinfra-no-sshd` at a port nothing listens on.
const TARGET = "tsinfra-sshd"
const NO_SSHD_TARGET = "tsinfra-no-sshd"
const SSHD_DIR = path.join(os.homedir(), "sshd")
const SSHD_PID_PATH = path.join(SSHD_DIR, "sshd.pid")
const SSH_DIR = path.join(os.homedir(), ".ssh")

const transport = getTransport(TARGET)

const doNothing = async () => {
  /* empty */
}

// Start sshd without `-D`, so it forks once it's listening, and the command returns when a connection can succeed.
const startSshd = async () => {
  await $`/usr/sbin/sshd -f ${path.join(SSHD_DIR, "sshd_config")}`
}

// Stop only the listening sshd, because the sshd serving a connection stays until that connection closes.
const stopSshd = async () => {
  const pidFile = bun.file(SSHD_PID_PATH)
  if (!(await pidFile.exists())) return

  // Ignore a failure, because the test may have stopped this sshd already.
  const pid = Number((await pidFile.text()).trim())
  attempt(() => process.kill(pid))
}

/** Returns an error's message chain, or anything else as it is, so a test can compare either. */
const toMessage = (value: unknown) => (value instanceof Error ? messageChain(value) : value)

/** Prepares a host 'a' on the sshd the way a run does, and creates its session. */
const createSshSession = async () => {
  const hostContext = await prepareHostContext(toLoadedHost("a", host(TARGET, doNothing)))
  if (isErr(hostContext)) throw hostContext

  return createHostSession(hostContext, "apply")
}

beforeEach(async () => {
  await startSshd()
})

afterEach(async () => {
  await closeConnections([TARGET])
  await stopSshd()
})

describe("the ssh transport against a real sshd", () => {
  it("should return from the first command, which opens the connection, and run from the SSH user's home", async () => {
    const { host: h } = await createSshSession()

    expect(await readOrMessage(h, "pwd")).toBe(os.homedir())
  })

  it("should pass the script on stdin without any other quoting", async () => {
    expect(await transport(String.raw`printf '%s' 'a "b" $c \d'`)).toStrictEqual({
      stdout: String.raw`a "b" $c \d`,
      stderr: "",
      exitCode: 0,
    })
  })

  it("should return a failing command's exit code and stderr as output", async () => {
    expect(await transport("echo out; echo err >&2; exit 3")).toStrictEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 3,
    })
  })

  it("should never give the session a terminal, even when the ssh config asks for one", async () => {
    expect(await transport("test -t 1 && echo terminal || echo no terminal; echo err >&2")).toStrictEqual({
      stdout: "no terminal\n",
      stderr: "err\n",
      exitCode: 0,
    })
  })

  it("should fail a host that can't be reached in preflight, with ssh's error", async () => {
    const { failure, ...hostReport } = await prepareAndRunHost(
      toLoadedHost("a", host(NO_SSHD_TARGET, doNothing)),
      "apply",
    )

    expect({ ...hostReport, message: toMessage(failure) }).toStrictEqual({
      name: "a",
      target: NO_SSHD_TARGET,
      started: false,
      message:
        "failed to prepare the host -> failed to read the SSH user's home directory -> failed to run the command over ssh -> exited with code 255: ssh: connect to host 127.0.0.1 port 2223: Connection refused",
    })
  })

  it("should fail the host when the connection goes away mid-run, and keep the command and its error", async () => {
    const hostSession = await createSshSession()
    await closeConnections([TARGET])
    await stopSshd()

    const sshError =
      "failed to run the command over ssh -> exited with code 255: ssh: connect to host 127.0.0.1 port 2222: Connection refused"
    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(`failed to read 'echo hi' -> ${sshError}`)

    expect(
      hostSession.stepRecords[0]?.commands.map(({ cmd, output }) => ({ cmd, output: toMessage(output) })),
    ).toStrictEqual([{ cmd: "echo hi", output: sshError }])
  })

  it("should leave no connection or socket behind once the run's connections close", async () => {
    await transport("true")
    await closeConnections([TARGET])

    const check = await $`ssh -o ControlPath=~/.ssh/tsinfra-%C -O check ${TARGET}`.nothrow().quiet()
    expect(check.exitCode).toBe(255)
    expect((await readdir(SSH_DIR)).filter((name) => name.startsWith("tsinfra-"))).toStrictEqual([])
  })
})
