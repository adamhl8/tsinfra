import { describe, expect, it } from "bun:test"

import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import { createRandomBytes } from "#core/__tests__/content.ts"
import type { CommandRecord } from "#core/recorder/records/command.ts"
import { getLocalTransport } from "#core/transport.ts"
import { runLocal } from "#core/transport/local.ts"
import type { RecordOutput, ShellOptions } from "#core/transport/shell.ts"
import { createShell } from "#core/transport/shell.ts"
import { HEREDOC_DELIMITER } from "#core/utils.ts"

/** Returns a recording shell on the local transport with `variables`, and its records. */
const createLocalShell = (variables: Record<string, string> = {}) => {
  const commandRecords: CommandRecord[] = []
  const shell = createShell(getLocalTransport(), {
    variables,
    commandRecorder: {
      recordCommand: (shellCommand) => {
        const commandRecord: CommandRecord = {
          ...shellCommand,
          toolCall: undefined,
          phase: undefined,
          output: undefined,
        }
        commandRecords.push(commandRecord)

        const recordOutput: RecordOutput = (output) => {
          commandRecord.output = output
        }
        return recordOutput
      },
    },
  })

  return { shell, commandRecords }
}

// Hold every character a value could break on in a script: a variable, both quotes, a space, and a newline.
const AWKWARD_VALUE = `a $HOME "b" 'c'\nd`

/**
 * Runs `cmd` on a shell bound to `shellOptions`, and returns its output and every script it sent. Stand in for `sudo`
 * with a function that prints its arguments, then runs them with an empty environment, as sudo resets it.
 */
const runInShell = async (shellOptions: ShellOptions, cmd: string) => {
  const scripts: string[] = []
  const shell = createShell(async (script) => {
    scripts.push(script)
    return runLocal(`sudo() { echo "sudo $*"; env -i PATH="$PATH" "$@"; }\n${script}`)
  }, shellOptions)

  return { output: await shell.inspect(cmd), scripts }
}

const toInput = (text: string) => new TextEncoder().encode(text)

const toPlainResult = <T>(result: Result<T>) => (isErr(result) ? messageChain(result) : result)

describe("createShell with input", () => {
  it("should give the command binary input intact", async () => {
    const { shell } = createLocalShell()
    const input = createRandomBytes(65_536)

    expect(await shell.exec(String.raw`base64 | tr -d '\n'`, { input })).toBe(input.toBase64())
  })

  it("should return the command's own exit code", async () => {
    const { shell } = createLocalShell()
    const cmd = "cat >/dev/null\nexit 3"
    const input = toInput("a")

    expect(await shell.inspect(cmd, { input })).toStrictEqual({ stdout: "", stderr: "", exitCode: 3 })
    expect(toPlainResult(await shell.exec(cmd, { input }))).toBe("exited with code 3")
  })

  it("should succeed with an empty stderr when the command never reads its stdin", async () => {
    const { shell } = createLocalShell()
    // Send more than the 64 KB pipe buffer, so `base64` is still writing when `true` exits.
    const input = createRandomBytes(1_000_000)

    expect(await shell.inspect("true", { input })).toStrictEqual({ stdout: "", stderr: "", exitCode: 0 })
  })

  it("should run a multi-line command", async () => {
    const { shell } = createLocalShell()

    expect(await shell.exec('read -r line\necho "got $line"', { input: toInput("a\n") })).toBe("got a\n")
  })

  it("should run a command that holds a line equal to the delimiter", async () => {
    const { shell } = createLocalShell()
    const cmd = `printf '%s|' '\n${HEREDOC_DELIMITER}\n'\ncat`

    expect(await shell.exec(cmd, { input: toInput("a") })).toBe(`\n${HEREDOC_DELIMITER}\n|a`)
  })

  it("should give the command the shell's variables", async () => {
    const { shell } = createLocalShell({ V: "v" })

    expect(await shell.exec(`printf '%s|' "$V"\ncat`, { input: toInput("a") })).toBe("v|a")
  })

  it("should record the command as written, never the input", async () => {
    const { shell, commandRecords } = createLocalShell()

    await shell.exec("cat", { input: toInput("secret") })

    expect(commandRecords).toStrictEqual([
      {
        cmd: "cat",
        label: undefined,
        toolCall: undefined,
        phase: undefined,
        output: { stdout: "secret", stderr: "", exitCode: 0 },
      },
    ])
  })
})

describe("createShell with sudo and variables", () => {
  it("should send a command with no options unchanged", async () => {
    expect(await runInShell({}, "echo hi")).toStrictEqual({
      output: { stdout: "hi\n", stderr: "", exitCode: 0 },
      scripts: ["echo hi"],
    })
  })

  it("should export the shell's variables, with any value unchanged", async () => {
    const { output } = await runInShell(
      { variables: { V: AWKWARD_VALUE, TOKEN: "t" } },
      `sh -c 'printf "%s|%s" "$V" "$TOKEN"'`,
    )

    expect(output).toStrictEqual({ stdout: `${AWKWARD_VALUE}|t`, stderr: "", exitCode: 0 })
  })

  it("should set the variables inside the root shell for sudo: true", async () => {
    const { output } = await runInShell({ sudo: true, variables: { V: AWKWARD_VALUE } }, 'printf %s "$V"')

    expect(output).toStrictEqual({ stdout: `sudo sh -s\n${AWKWARD_VALUE}`, stderr: "", exitCode: 0 })
  })

  it("should keep a sudo: true command from reading the rest of the script as its stdin", async () => {
    const { output } = await runInShell({ sudo: true }, "cat\necho after")

    expect(output).toStrictEqual({ stdout: "sudo sh -s\nafter\n", stderr: "", exitCode: 0 })
  })

  it("should give the exit code of a sudo: true script", async () => {
    const { output } = await runInShell({ sudo: true }, "set -eu\nfalse\necho not-reached")

    expect(output).toStrictEqual({ stdout: "sudo sh -s\n", stderr: "", exitCode: 1 })
  })
})
