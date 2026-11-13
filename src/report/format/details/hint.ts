import { formatHint } from "#report/format/elements/elements.ts"
import type { FailureHint } from "#session/session.ts"

// Name both fixes, because `sudo: true` and `sudo: { password }` each give sudo what it needs.
const SUDO_OPTION_HINT = "sudo needs a password on this host, so set the sudo option on host()"

// Point at the line ssh names as offending, because at `LogLevel=ERROR` it prints that, but not its `ssh-keygen` command.
const CHANGED_HOST_KEY_HINT = "if the host was recreated, remove its old key from the known_hosts line named above"

/** Returns the words of a hint, for its kind. */
const getHintWords = (hint: FailureHint): string => {
  if (hint.kind === "changedHostKey") return CHANGED_HOST_KEY_HINT
  if (hint.kind === "sudoOption") return SUDO_OPTION_HINT
  return `run 'ssh ${hint.target}' once to check the host's key and save it`
}

/** Formats how to fix a failure, in the words for its kind. */
export const formatFailureHint = (hint: FailureHint): string => formatHint(getHintWords(hint))
