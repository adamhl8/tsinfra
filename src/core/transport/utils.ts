// `sh -s` runs each line as soon as it reads it, and that line's command shares the shell's stdin.
// In `cat\necho after`, `cat` reads `echo after` as its input, so `echo after` never runs.
// Wrap `cmd` in a group so the shell reads all of it before running any of it.
// Give the group /dev/null as stdin so its commands can't read the rest of `cmd` either.
export const wrapCommand = (cmd: string) => `{ ${cmd}\n} </dev/null`

/** Ends a heredoc of base64. Base64 has no `_`, so the encoded data can never hold this line. */
export const HEREDOC_DELIMITER = "__TSINFRA_EOF__"

/**
 * Wraps `cmd` so its stdin is `input`, decoded from base64 in a heredoc. Put the heredoc's body before `cmd`, because
 * the body starts at the next newline, and `cmd` can span lines.
 */
export const wrapCommandWithInput = (cmd: string, input: Uint8Array) => {
  const encodedInput = input.toBase64()
  return `base64 -d <<'${HEREDOC_DELIMITER}' |\n${encodedInput}\n${HEREDOC_DELIMITER}\n{ ${cmd}\n}`
}
