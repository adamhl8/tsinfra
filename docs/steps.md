# Steps

Everything a host script does to a target goes through `h`, the context passed to the host function.

<!-- toc -->

- [`step`](#step)
- [`file`](#file)
- [`run`](#run)
- [`read`](#read)
- [Failure](#failure)
- [What `plan` can and cannot show](#what-plan-can-and-cannot-show)

<!-- tocstop -->

```ts
interface Host {
  readonly name: string // the host file's name, e.g. "sonarr"
  step(name: string, spec: StepSpec): Promise<StepResult>
  file(path: string, spec: FileSpec): Promise<StepResult>
  run(name: string, cmd: string, opts?: RunOpts): Promise<StepResult>
  read(cmd: string): Promise<string>
}

type StepResult = {
  status: "ok" | "changed" | "would-change" | "waiting" | "failed" | "skipped"
  changed: boolean // true for "changed", "would-change", and "waiting"
}
```

`changed` is what lets a script react to a step, as in `if (unit.changed) await h.run(...)`. In plan mode it means
"would change", so the follow-up shows up in the plan as "would run" exactly when it would run for real.

## `step`

```ts
type StepSpec = (
  | { check: string } // exit 0 means already right
  | { read: string; want: string } // compare output to a value
) & {
  fix: string | string[]
  noop?: string // message shown when already right, in verbose output
  sudo?: boolean // run the fix under sudo
  verify?: boolean // default true
  secret?: boolean // hide the diff
  requires?: Need[]
  provides?: Need[]
}
```

A step has one of two kinds of check.

**`check`** is a command whose exit status is the answer. Exit 0 means the state is already right and nothing happens.
Anything else means the fix runs. There is nothing to diff, so `plan` shows only the step's name. This is the shape of
`converge` in the pyinfra helper, and it suits state that only answers yes or no, like `brew bundle check`.

**`read` and `want`** compare a command's output to a value. `read` runs on the target and `want` is computed in your
script on the control machine. Trailing newlines are stripped from the output (the way `$(cmd)` does), then the two are
compared exactly. When they differ, `plan` shows a line diff.

```ts
const latest = await latestCaddyVersion() // fetch() on the control machine
await h.step("Caddy is up to date", {
  read: "caddy version | cut -d' ' -f1",
  want: latest,
  fix: buildCaddy,
})
```

A broken `read` must not look converged. If `read` exits non-zero and its output still equals `want`, the step fails
instead of reporting ok. A read whose non-zero exit is legitimate (`systemctl is-active` exits 3 for inactive) already
produces output that differs from `want`, so this only catches the broken case.

**`fix`** is one command or a list. A list runs in order, and the first one that fails stops the step and is named in
the error. `sudo: true` runs the whole fix under `sudo`. Writing `sudo` inside a command also works, because commands
are just strings.

**Verification.** After a fix runs, the check runs again. If it still does not pass, the step fails with "fix ran but
the check still fails", plus the diff or the check's stderr. A step that reports a change on every run is a bug, and
this is what surfaces it the first time. `verify: false` is for fixes whose effect is genuinely delayed, like a setting
that needs a re-login.

**Plan mode** runs the check and never the fix. A step that would change reports `would-change`.

## `file`

```ts
type FileSpec = {
  content: string | Buffer // computed on the control machine
  mode?: string // octal, default "644", or "600" when secret
  owner?: string // managed only when given
  group?: string // managed only when given
  sudo?: boolean
  secret?: boolean
  requires?: Need[]
  provides?: Need[]
}
```

Writes `content` to `path` on the target and reports whether it changed. A leading `~/` means the connecting user's
home on the target.

- **The check** is one command that prints the remote file's sha256, mode, and owner and group when they are declared,
  or a marker meaning the file is absent. The content's sha256 is computed locally and compared. No file is transferred
  just to learn that it is unchanged. The command has to work on GNU and BSD alike (`sha256sum` or `shasum -a 256`,
  `stat -c` or `stat -f`), because the Mac is a host too.
- **The diff** fetches the remote contents with `cat`, only when the hashes differ. Binary content (null bytes) shows
  sizes instead of a diff. `secret: true` shows "contents hidden".
- **The write** creates missing parent directories, writes the content to a temp file next to the destination, sets
  mode and ownership on the temp file, then moves it into place. The file never exists at its destination with the
  wrong permissions, which matters for secrets. See [Transport](./transport.md#file-writes).
- **Verification** re-runs the check.
- **`sudo: true`** runs the check and the diff under sudo too, not just the write. See
  [Transport](./transport.md#sudo).

## `run`

```ts
type RunOpts = { sudo?: boolean; requires?: Need[]; provides?: Need[] }
```

A command with no check, so it runs every time it is reached. In plan mode it does not run and reports `would-change`
("would run" in the output). Use it for follow-ups that only make sense after something else changed, like
`daemon-reload`, and for genuinely unconditional work. Anything that can be checked should be a `step`.

## `read`

Runs a command on the target in both modes and returns its output, with trailing newlines stripped. It is for
observations a script branches on:

```ts
const arch = await h.read("uname -m")
```

A non-zero exit fails the host, with the command's stderr. Append `|| true` when a non-zero exit is a legitimate
answer. A `read` must not change anything, because it also runs during `plan`. Nothing can enforce that.

## Failure

Steps never throw, and scripts never check results for errors.

When a step fails, the host is marked failed. From then on, every call on `h` returns `skipped` straight away without
touching the target, and `read` returns an empty string. The script keeps running to the end, but nothing more happens
on the host. The CLI reports the host as failed, with the step that failed and its output.

Only calls on `h` are stopped. Code in the script that has its own local side effects, like writing a file on the
control machine, still runs after a failure. Keep side effects in steps.

If the host function itself throws (a bug in the script), the CLI catches it and reports the host as failed in the same
way.

## What `plan` can and cannot show

`plan` runs every check against the machine as it is now. A step after a would-change step is checked against the old
state, not the state that step would leave behind. For most steps that does not matter. Where it does, a
[requirement](./requirements.md) is how you say so, and `plan` then shows "waits on" instead of a misleading answer.

When anything would change, `plan` ends with a one-line reminder that later steps were checked against the current
state.
