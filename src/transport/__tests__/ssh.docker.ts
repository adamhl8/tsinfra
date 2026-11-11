import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import bun, { $ } from "bun"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { prepareAndRunHost, prepareSession, readOrMessage, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareBaseTransport } from "#hosts/prepare/host-details/host-details.ts"
import { closeConnections, createShell, getLocalTransport } from "#transport/transport.ts"

// `setup.sh` points each of these at the sshd this file starts, except `tsinfra-no-sshd`, at a port nothing listens on.
// Each host-key target has a `known_hosts` entry of its own: none for the new and the strict host, and a wrong key for
// the changed one.
const TARGET = "tsinfra-sshd"
const NEW_HOST_TARGET = "tsinfra-new"
const STRICT_TARGET = "tsinfra-strict"
const CHANGED_KEY_TARGET = "tsinfra-changed"
const NO_SSHD_TARGET = "tsinfra-no-sshd"
const ALL_TARGETS = [TARGET, NEW_HOST_TARGET, STRICT_TARGET, CHANGED_KEY_TARGET, NO_SSHD_TARGET]

const SSHD_DIR = path.join(os.homedir(), "sshd")
const SSHD_PID_PATH = path.join(SSHD_DIR, "sshd.pid")
const SSH_DIR = path.join(os.homedir(), ".ssh")
const KNOWN_HOSTS_PATH = path.join(SSH_DIR, "known_hosts")

const doNothing = async () => {
  /* empty */
}

/** Prepares the transport to `target`, or throws why it couldn't. */
const prepareOrThrow = async (target: string) => {
  const targetTransport = await prepareBaseTransport(createShell(getLocalTransport()), target)
  if (isErr(targetTransport)) throw targetTransport

  return targetTransport
}

const transport = await prepareOrThrow(TARGET)

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

/** Reports whether `known_hosts` has a key for `name`. Use `ssh-keygen -F`, because Debian's ssh hashes the names. */
const findKnownHost = async (name: string) => (await $`ssh-keygen -F ${name}`.nothrow().quiet()).exitCode === 0

/** Prepares and runs a host 'a' on `target` the way a run does, and returns its record. */
const runHostOn = async (target: string) => prepareAndRunHost(toLoadedHost("a", host(target, doNothing)), "apply")

/** Prepares a host 'a' on the sshd the way a run does, and creates its session. */
const createSshSession = async () => prepareSession(toLoadedHost("a", host(TARGET, doNothing)), "apply")

beforeEach(async () => {
  await startSshd()
})

afterEach(async () => {
  await closeConnections(ALL_TARGETS)
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

  it("should fail a host that can't be reached in preparation, with ssh's error", async () => {
    const hostRecord = await runHostOn(NO_SSHD_TARGET)

    expect(hostRecord).toMatchObject({
      name: "a",
      target: NO_SSHD_TARGET,
      stepRecords: [],
      failure: { kind: "preparation", hints: [] },
    })
    expect(toMessage(hostRecord.failure?.error)).toBe(
      "failed to read the SSH user's home directory -> failed to run the command over ssh -> exited with code 255: ssh: connect to host 127.0.0.1 port 2223: Connection refused",
    )
  })

  it("should take a new host's key, and keep ssh's notice about it off stderr", async () => {
    const newHostTransport = await prepareOrThrow(NEW_HOST_TARGET)

    expect(await findKnownHost(NEW_HOST_TARGET)).toBe(false)
    expect(await newHostTransport("echo hi")).toStrictEqual({ stdout: "hi\n", stderr: "", exitCode: 0 })
    expect(await findKnownHost(NEW_HOST_TARGET)).toBe(true)
  })

  it("should fail a new host the config checks strictly, with a hint to ssh to it once", async () => {
    const hostRecord = await runHostOn(STRICT_TARGET)

    expect(toMessage(hostRecord.failure?.error)).toEndWith("Host key verification failed.")
    expect(hostRecord.failure?.hints).toStrictEqual([
      `run 'ssh ${STRICT_TARGET}' once to check the host's key and save it`,
    ])
  })

  it("should fail a host whose key changed, with the line of the old key and a hint to remove it", async () => {
    const knownHosts = await bun.file(KNOWN_HOSTS_PATH).text()
    const hostRecord = await runHostOn(CHANGED_KEY_TARGET)

    expect(toMessage(hostRecord.failure?.error)).toContain(`Offending ED25519 key in ${KNOWN_HOSTS_PATH}:1`)
    expect(hostRecord.failure?.hints).toStrictEqual([
      "if the host was recreated, remove its old key from the known_hosts line named above",
    ])
    expect(await bun.file(KNOWN_HOSTS_PATH).text()).toBe(knownHosts)
  })

  it("should fail the host when the connection goes away mid-run, and keep the command and its error", async () => {
    const hostSession = await createSshSession()
    await closeConnections([TARGET])
    await stopSshd()

    const sshError =
      "failed to run the command over ssh -> exited with code 255: ssh: connect to host 127.0.0.1 port 2222: Connection refused"
    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(`failed to read 'echo hi' -> ${sshError}`)

    expect(
      hostSession.hostRecord.stepRecords[0]?.commands.map(({ cmd, output }) => ({ cmd, output: toMessage(output) })),
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
