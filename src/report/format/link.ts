import pc from "picocolors"

import type { LabelRow } from "#report/format.ts"
import { toOwnerRow } from "#report/format/owner.ts"
import { styleGot, styleWant } from "#report/format/styles.ts"
import type { LinkComparisonValues, LinkChange } from "#session/handlers/link/comparison.ts"

// Give each way of making a link its words, and italicize them, because they describe the change rather than show a value.
const REPLACEMENT_WORDS: Record<Exclude<LinkChange["kind"], "same" | "changed">, string> = {
  new: "new link to",
  replacesFile: "replaces a file, with a link to",
  replacesEmptyDirectory: "replaces an empty directory, with a link to",
}

const formatLinkChange = (linkChange: Exclude<LinkChange, { kind: "same" }>): string => {
  if (linkChange.kind === "changed") return `${styleGot(linkChange.got)} -> ${styleWant(linkChange.want)}`
  return `${pc.italic(REPLACEMENT_WORDS[linkChange.kind])} ${styleWant(linkChange.want)}`
}

/** Returns a row for how the link changes, then a row for each owner that changes. */
export const toLinkRows = (values: LinkComparisonValues): LabelRow[] => {
  const { linkChange, ownerChanges } = values
  const linkChangeRows =
    linkChange.kind === "same" ? [] : [{ label: "target", valueLines: [formatLinkChange(linkChange)] }]
  return [...linkChangeRows, ...ownerChanges.map((ownerChange) => toOwnerRow(ownerChange))]
}
