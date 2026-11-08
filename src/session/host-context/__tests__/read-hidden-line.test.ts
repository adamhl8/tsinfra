import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { Terminal, spawn } from "bun"

const FIXTURE = path.join(import.meta.dir, "fixtures", "read-hidden-line.ts")
const PROMPT = "password: "

/**
 * Runs the fixture in a terminal and types `keys` once the prompt shows. Returns everything the terminal showed, and
 * the signal that ended the process, if any.
 */
const typeIntoPrompt = async (keys: string) => {
  const decoder = new TextDecoder()
  let screen = ""
  const { promise: prompted, resolve } = Promise.withResolvers<string>()
  await using terminal = new Terminal({
    data: (_terminal, data) => {
      screen += decoder.decode(data, { stream: true })
      if (screen.includes(PROMPT)) resolve(screen)
    },
  })

  const subprocess = spawn([process.execPath, FIXTURE], { terminal })
  await prompted
  terminal.write(keys)
  await subprocess.exited

  return { screen, signalCode: subprocess.signalCode ?? undefined }
}

/** Returns what the terminal shows when the reader returns `line` and leaves stdin as it found it. */
const expectedScreen = (line?: string) =>
  `${PROMPT}\r\n${JSON.stringify({ line, isRaw: false, keypressListeners: 0 })}\r\n`

describe("readHiddenLine", () => {
  it("should return the edited line without showing what was typed", async () => {
    expect(await typeIntoPrompt("abc\u007Fd\r")).toStrictEqual({ screen: expectedScreen("abd"), signalCode: undefined })
  })

  it("should edit the line with the arrow keys and Ctrl-U", async () => {
    expect(await typeIntoPrompt("ab\u001B[Dx\u0015yz\r")).toStrictEqual({
      screen: expectedScreen("yzb"),
      signalCode: undefined,
    })
  })

  it("should return undefined for Ctrl-D in an empty line", async () => {
    expect(await typeIntoPrompt("\u0004")).toStrictEqual({ screen: expectedScreen(), signalCode: undefined })
  })

  it("should return undefined for Ctrl-D in the middle of the line", async () => {
    expect(await typeIntoPrompt("ab\u0004c\r")).toStrictEqual({ screen: expectedScreen(), signalCode: undefined })
  })

  it("should end the process with SIGINT for Ctrl-C", async () => {
    expect(await typeIntoPrompt("ab\u0003")).toStrictEqual({ screen: `${PROMPT}\r\n`, signalCode: "SIGINT" })
  })
})
