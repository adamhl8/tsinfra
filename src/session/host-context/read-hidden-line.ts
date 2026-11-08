import { once } from "node:events"
import process from "node:process"
import type { Key } from "node:readline"
import { createInterface } from "node:readline"
import { Writable } from "node:stream"

/**
 * Prints `prompt` to stderr and reads a line from the terminal without echoing it. Returns `undefined` for Ctrl-D,
 * pressed anywhere in the line. Ctrl-C ends the run.
 */
export const readHiddenLine = async (prompt: string): Promise<string | undefined> => {
  const { stderr, stdin } = process

  // Give readline an output that drops everything, so nothing typed is echoed.
  const mutedOutput = new Writable({
    // oxlint-disable-next-line promise/prefer-await-to-callbacks - a `Writable` reports each write through `callback`
    write: (_chunk, _encoding, callback) => {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks - a `Writable` reports each write through `callback`
      callback()
    },
  })
  const rl = createInterface({ input: stdin, output: mutedOutput, terminal: true })

  let line: string | undefined
  rl.once("line", (value) => {
    line = value
    rl.close()
  })

  // Close on Ctrl-D anywhere in the line, because readline only closes on it in an empty line.
  const onKeypress = (_char: string | undefined, key: Key) => {
    if (key.ctrl && key.name === "d") rl.close()
  }
  stdin.on("keypress", onKeypress)

  // Closing turns raw mode off and pauses stdin.
  // End the prompt's line in the listener, because it runs inside `rl.close()`, before Ctrl-C ends the process.
  rl.once("close", () => {
    stdin.off("keypress", onKeypress)
    stderr.write("\n")
  })

  // Raise `SIGINT` again after closing, because readline takes Ctrl-C in raw mode, and the run should end as usual.
  rl.once("SIGINT", () => {
    rl.close()
    process.kill(process.pid, "SIGINT")
  })

  // Print the prompt only once readline has turned raw mode on, because the terminal echoes what's typed before that.
  stderr.write(prompt)

  await once(rl, "close")
  return line
}
