// `sh -s` runs each line as soon as it reads it, and that line's command shares the shell's stdin.
// In `cat\necho after`, `cat` reads `echo after` as its input, so `echo after` never runs.
// Wrap `cmd` in a group so the shell reads all of it before running any of it.
// Give the group /dev/null as stdin so its commands can't read the rest of `cmd` either.
export const wrapCommand = (cmd: string) => `{ ${cmd}\n} </dev/null`
