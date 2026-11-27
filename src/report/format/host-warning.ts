import type { NamedFact } from "#core/hosts/prepare/host-details/facts.ts"
import packageJson from "#package.json" with { type: "json" }
import type { FormattedHostWarning } from "#report/format.ts"
import { hintElement, warningLabelElement } from "#report/format/elements/asides.ts"
import { warningValueElement } from "#report/format/elements/values.ts"
import type { HostWarning } from "#report/host-block.ts"

// Point each warning's words at the value it's about, which follows them.
const UNKNOWN_FACT_WORDS: Record<NamedFact, string> = {
  platform: "tsinfra has no name for this platform, so h.facts.platform is what the host printed ->",
  arch: "tsinfra has no name for this CPU architecture, so h.facts.arch is what the host printed ->",
}

const REPORT_HINT = `please report it at ${packageJson.bugs.url}, so tsinfra can name it`

/** Formats a warning about the whole host, with the value it's about after its words, and how to report it under it. */
export const formatHostWarning = (hostWarning: HostWarning): FormattedHostWarning => {
  const { fact, value } = hostWarning
  const line = `${warningLabelElement("warning")} ${UNKNOWN_FACT_WORDS[fact]} ${warningValueElement(value)}`
  return { line, hint: hintElement(REPORT_HINT) }
}
