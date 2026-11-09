import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import bun, { $ } from "bun"

import { writeFakeTool } from "#__tests__/session.ts"

const FIXTURE = path.join(import.meta.dir, "fixtures", "run-over-ssh.ts")

const RUN_ARGS =
  "-T -o ControlMaster=auto -o ControlPath=~/.ssh/tsinfra-%C -o ControlPersist=60 -o BatchMode=yes -- a sh -s"
const CLOSE_ARGS = "-o ControlPath=~/.ssh/tsinfra-%C -O stop -- a"

// Log each call's args, and pass `-O stop` without doing anything.
const LOG_CALL = [
  'dir="$(dirname "$0")"',
  `printf '%s\\n' "$*" >>"$dir/calls.log"`,
  'case "$*" in *"-O stop"*) exit 0 ;; esac',
].join("\n")

// Run the script on the control machine, as the host would.
const RUN_SCRIPT = "exec sh -s"

const CLOSING_CONNECTION = "echo 'mux_client_hello_exchange: write packet: Broken pipe' >&2; exit 255"

/**
 * Runs `cmd` on target `a` through the transport in a subprocess, with a fake `ssh` first on `PATH` that runs `sshBody`
 * after logging its call. Use a subprocess, because Bun looks commands up in the `PATH` the process started with.
 * Returns the output or the error's message chain, and the args of each `ssh` call.
 */
const runOverFakeSsh = async (sshBody: string, cmd = "echo hi") => {
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "ssh", `${LOG_CALL}\n${sshBody}`)
  const env = { ...process.env, PATH: `${binDir}:${process.env["PATH"]}` }

  const output: unknown = JSON.parse(await $`${process.execPath} ${FIXTURE} a ${cmd}`.env(env).text())
  const calls = (await bun.file(path.join(binDir, "calls.log")).text()).trim().split("\n")
  return { output, calls }
}

describe("the ssh transport", () => {
  it("should send the script on stdin with its options, and stop the connection once per target", async () => {
    expect(await runOverFakeSsh(RUN_SCRIPT, "echo out; echo err >&2; exit 3")).toStrictEqual({
      output: { stdout: "out\n", stderr: "err\n", exitCode: 3 },
      calls: [RUN_ARGS, CLOSE_ARGS],
    })
  })

  it("should run a command again once when the connection closed as it joined", async () => {
    const closingOnce = `[ -e "$dir/joined" ] || { touch "$dir/joined"; ${CLOSING_CONNECTION}; }\n${RUN_SCRIPT}`

    expect(await runOverFakeSsh(closingOnce)).toStrictEqual({
      output: { stdout: "hi\n", stderr: "", exitCode: 0 },
      calls: [RUN_ARGS, RUN_ARGS, CLOSE_ARGS],
    })
  })

  it("should fail when the connection closes on the second try too", async () => {
    expect(await runOverFakeSsh(CLOSING_CONNECTION)).toStrictEqual({
      output:
        "failed to run the command over ssh -> exited with code 255: mux_client_hello_exchange: write packet: Broken pipe",
      calls: [RUN_ARGS, RUN_ARGS, CLOSE_ARGS],
    })
  })

  it("should fail on ssh's own exit code with its stderr, and not run the command again", async () => {
    const refused = "echo 'ssh: connect to host a port 22: Connection refused' >&2; exit 255"

    expect(await runOverFakeSsh(refused)).toStrictEqual({
      output:
        "failed to run the command over ssh -> exited with code 255: ssh: connect to host a port 22: Connection refused",
      calls: [RUN_ARGS, CLOSE_ARGS],
    })
  })
})
