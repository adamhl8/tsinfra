import process from "node:process"

import type { Message } from "@optique/core/message"
import { lineBreak, text } from "@optique/core/message"
import type { TerminalTheme } from "@optique/core/terminal"
import { printError } from "@optique/run"
import { messageChain } from "ts-explicit-errors"

/** Styles the `Error:` label red, for the errors tsinfra prints and the ones Optique prints while parsing. */
export const ERROR_THEME: TerminalTheme = {
  errorLabel: (_term, { text: label }) => ({
    type: "style",
    style: { foreground: "red", bold: true },
    children: [{ type: "text", text: label }],
  }),
}

/** Turns an error into a message for Optique's `printError`, with a line break wherever the chain has one. */
export const toErrorMessage = (error: Error): Message =>
  messageChain(error)
    .split("\n")
    .flatMap((line, index) => (index === 0 ? [text(line)] : [lineBreak(), text(line)]))

// Follow the color rules Optique's `run()` follows, because `printError` checks only whether stderr is a terminal.
// Leave `colors` out otherwise, so `printError` still colors a terminal.
const getErrorColors = (): { colors?: boolean } => {
  if (process.env["FORCE_COLOR"]) return { colors: true }
  if (process.env["NO_COLOR"]) return { colors: false }
  return {}
}

/** Prints one of tsinfra's own errors to stderr, styled like the errors Optique prints while parsing. */
export const printTsinfraError = (error: Error) => {
  printError(toErrorMessage(error), { theme: ERROR_THEME, ...getErrorColors() })
}
