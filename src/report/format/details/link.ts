import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { formatOwnerChange } from "#report/format/details/owner.ts"
import type { LinkComparisonValues, LinkChange } from "#session/session.ts"
import { styleDescription, styleGot, styleWant } from "#styles.ts"

// Give each way of making a link its words.
const REPLACEMENT_WORDS: Record<Exclude<LinkChange["kind"], "same" | "changed">, string> = {
  new: "new link to",
  replacesFile: "replaces a file, with a link to",
  replacesEmptyDirectory: "replaces an empty directory, with a link to",
}

const formatLinkChange = (linkChange: Exclude<LinkChange, { kind: "same" }>): string => {
  if (linkChange.kind === "changed") return `${styleGot(linkChange.got)} -> ${styleWant(linkChange.want)}`
  return `${styleDescription(REPLACEMENT_WORDS[linkChange.kind])} ${styleWant(linkChange.want)}`
}

/** Formats how a link changes as its rows: one for its target, then one for each owner that changes. */
export const formatLinkValues = (values: LinkComparisonValues): AlignedRow[] => {
  const { linkChange, ownerChanges } = values
  const linkChangeRows = linkChange.kind === "same" ? [] : [formatAlignedRow("target", [formatLinkChange(linkChange)])]
  const ownerRows = ownerChanges.map((ownerChange) => formatOwnerChange(ownerChange))
  return [...linkChangeRows, ...ownerRows]
}
