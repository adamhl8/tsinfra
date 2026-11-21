import process from "node:process"

import { attempt } from "ts-explicit-errors"

// Forward the signals that end a run, because commands start detached, where the terminal's signals don't reach them.
const FORWARDED_SIGNALS = ["SIGINT", "SIGHUP", "SIGTERM"] as const

const runningPids = new Set<number>()

/**
 * Sends `signal` to each running command's process group, then raises it again on tsinfra, so the run ends the way it
 * would without the listener. `process.once` has already removed the listener, so the second one meets the default.
 */
const forwardSignal = (signal: NodeJS.Signals) => {
  // Ignore a failure, because a group can exit before the signal reaches it.
  for (const pid of runningPids) attempt(() => process.kill(-pid, signal))
  process.kill(process.pid, signal)
}

/**
 * Sends the signals that end a run on to `pid`'s process group, until the returned function is called. The listeners
 * exist only while a command runs, so a signal at any other time ends the run as usual.
 */
export const trackRunningProcess = (pid: number): (() => void) => {
  if (runningPids.size === 0) for (const signal of FORWARDED_SIGNALS) process.once(signal, forwardSignal)
  runningPids.add(pid)

  return () => {
    runningPids.delete(pid)
    if (runningPids.size === 0) for (const signal of FORWARDED_SIGNALS) process.off(signal, forwardSignal)
  }
}
