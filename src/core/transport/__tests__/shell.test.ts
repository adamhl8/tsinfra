import { describe, expect, it } from "bun:test"

import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import { CONTENT_LIMIT_BYTES, createRandomBytes } from "#core/__tests__/content.ts"
import { toBytes } from "#core/session/handlers/shared/filesystem/bytes.ts"
import { createRecordingTransport } from "#core/session/recorder/commands.ts"
import type { CommandRecord } from "#core/session/recorder/records.ts"
import { getLocalTransport } from "#core/transport.ts"
import { createShell } from "#core/transport/shell.ts"
import { createStepTransport } from "#core/transport/step.ts"
import { HEREDOC_DELIMITER } from "#core/transport/utils.ts"

/** Returns a recording shell on the local transport, through a step transport with `variables`, and its records. */
const createLocalShell = (variables: Record<string, string> = {}) => {
  const commandRecords: CommandRecord[] = []
  const stepTransport = createStepTransport(getLocalTransport(), { sudo: false, variables })
  const shell = createShell(
    createRecordingTransport(stepTransport, {
      recordCommand: (commandRecord) => {
        commandRecords.push(commandRecord)
      },
      recordOutput: (commandRecord, output) => {
        commandRecord.output = output
      },
    }),
  )

  return { shell, commandRecords }
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
    const input = createRandomBytes(CONTENT_LIMIT_BYTES)

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

  it("should give the command the step's variables", async () => {
    const { shell } = createLocalShell({ V: "v" })

    expect(await shell.exec(`printf '%s|' "$V"\ncat`, { input: toInput("a") })).toBe("v|a")
  })

  it("should record the command as written and the input's size, never the input", async () => {
    const { shell, commandRecords } = createLocalShell()

    await shell.exec("cat", { input: toInput("secret") })

    expect(commandRecords).toStrictEqual([
      { cmd: "cat", inputSize: toBytes(6), output: { stdout: "secret", stderr: "", exitCode: 0 } },
    ])
  })
})
