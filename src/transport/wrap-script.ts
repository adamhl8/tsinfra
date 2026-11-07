// `sh -s` runs each line as soon as it reads it, and that line's command shares the script's stdin.
// In `cat\necho after`, `cat` reads `echo after` as its input, so `echo after` never runs.
// Wrap `script` in a group so the shell reads all of it before running any of it.
// Give the group /dev/null as stdin so its commands can't read the script either.
export const wrapScript = (script: string) => `{ ${script}\n} </dev/null`
