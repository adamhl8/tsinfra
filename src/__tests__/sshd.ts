import os from "node:os"
import path from "node:path"
import process from "node:process"

import bun, { $ } from "bun"
import { attempt } from "ts-explicit-errors"

/** The target that reaches the sshd `setup.sh` gives the user running the tests, which logs in only that user. */
export const SSHD_TARGET = "tsinfra-sshd"

const SSHD_DIR = path.join(os.homedir(), "sshd")
const SSHD_PID_PATH = path.join(SSHD_DIR, "sshd.pid")

/** Starts the user's sshd. Start it without `-D`, so it forks once it's listening, and returns when it can connect. */
export const startSshd = async () => {
  await $`/usr/sbin/sshd -f ${path.join(SSHD_DIR, "sshd_config")}`
}

/** Stops only the listening sshd, because the sshd serving a connection stays until that connection closes. */
export const stopSshd = async () => {
  const pidFile = bun.file(SSHD_PID_PATH)
  if (!(await pidFile.exists())) return

  // Ignore a failure, because the test may have stopped this sshd already.
  const pid = Number((await pidFile.text()).trim())
  attempt(() => process.kill(pid))
}
