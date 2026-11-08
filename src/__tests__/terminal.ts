import process from "node:process"

import { spawn } from "bun"

/** Counts how many times `text` shows on `screen`. */
const countShown = (screen: string, text: string) => screen.split(text).length - 1

/**
 * Runs `cmd` in a terminal, and types the next of `answers` each time `prompt` shows again. Returns everything the
 * terminal showed, and how the process ended.
 */
export const answerPrompts = async (
  cmd: string[],
  prompt: string,
  answers: string[],
  env: Record<string, string | undefined> = process.env,
) => {
  const decoder = new TextDecoder()
  let screen = ""
  let answered = 0
  // Wait for the terminal to close as well as for the process to exit, because its last output can arrive after.
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<undefined>()

  const subprocess = spawn(cmd, {
    env,
    terminal: {
      data: (terminal, data) => {
        screen += decoder.decode(data, { stream: true })
        const answer = answers[answered]
        if (answer === undefined || countShown(screen, prompt) <= answered) return
        terminal.write(answer)
        answered += 1
      },
      exit: () => {
        resolveClosed(undefined)
      },
    },
  })
  await Promise.all([subprocess.exited, closed])
  subprocess.terminal?.close()

  return { screen, exitCode: subprocess.exitCode ?? undefined, signalCode: subprocess.signalCode ?? undefined }
}
