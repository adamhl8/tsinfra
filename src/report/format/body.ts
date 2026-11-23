import { messageChain } from "ts-explicit-errors"

import type { DetailContext, DetailRows } from "#report/format/details.ts"
import { formatDetail } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { errorLineElement } from "#report/format/elements/asides.ts"
import type { StatusLineEntry } from "#report/host-block.ts"
import { splitNonEmptyLines } from "#utils.ts"

/** The lines under an entry's status line, each formatted, before layout lines up its aligned rows and indents them. */
export interface Body {
  /** Unset when the entry has no error, so layout indents the details only under an error. */
  errorLines?: string[]
  detailRows: DetailRows[]
}

/**
 * Formats an entry's error lines in red, if it failed, and each of its details' rows. Hands the step messages that show
 * among the commands to the commands detail, because it places them.
 */
export const formatBody = (statusLineEntry: StatusLineEntry, diffLimits: DiffLimits): Body => {
  const { details, error } = statusLineEntry
  const stepMessages = details.flatMap((detail) => (detail.kind === "stepMessages" ? detail.stepMessages : []))
  const stepMessagesAmongCommands = stepMessages.filter(({ amongCommands }) => amongCommands !== undefined)
  const ctx: DetailContext = { diffLimits, stepMessagesAmongCommands }
  const detailRows = details.map((detail) => formatDetail(ctx, detail))
  if (!error) return { detailRows }

  // Leave out empty lines, like the one sudo prints after an empty prompt, because they only open a gap in the error.
  const errorLines = splitNonEmptyLines(messageChain(error)).map((errorLine) => errorLineElement(errorLine))
  return { errorLines, detailRows }
}
