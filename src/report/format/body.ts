import { messageChain } from "ts-explicit-errors"

import type { DetailRows, DiffLimits } from "#report/format/details/details.ts"
import { formatDetail } from "#report/format/details/details.ts"
import { errorLineElement } from "#report/format/elements/elements.ts"
import type { HostBlockEntry } from "#report/host-block/host-block.ts"
import { splitNonEmptyLines } from "#utils.ts"

/** The lines under an entry's status line, each formatted, before layout lines up its aligned rows and indents them. */
export interface Body {
  /** Unset when the entry has no error, so layout indents the details only under an error. */
  errorLines?: string[]
  detailRows: DetailRows[]
}

/** Formats an entry's error lines in red, if it failed, and each of its details' rows. */
export const formatBody = (hostBlockEntry: HostBlockEntry, diffLimits: DiffLimits): Body => {
  const { details, error } = hostBlockEntry
  const detailRows = details.map((detail) => formatDetail(detail, diffLimits))
  if (!error) return { detailRows }

  // Leave out empty lines, like the one sudo prints after an empty prompt, because they only open a gap in the error.
  const errorLines = splitNonEmptyLines(messageChain(error)).map((errorLine) => errorLineElement(errorLine))
  return { errorLines, detailRows }
}
