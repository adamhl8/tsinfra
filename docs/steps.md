# Steps

Everything a host script does to its host goes through `h`, the context passed to the host function.

<!-- toc -->

- [Choosing a method](#choosing-a-method)
- [Commands](#commands)
- [Steps](#steps)
- [`read`](#read)
- [`inspect`](#inspect)
- [`file`](#file)
  - [Reading the state](#reading-the-state)
  - [The diff](#the-diff)
  - [The write](#the-write)
  - [`sudo` and permissions](#sudo-and-permissions)
- [`link`](#link)
- [`ensure`](#ensure)
  - [What a check may change](#what-a-check-may-change)
  - [`fix`](#fix)
- [`run`](#run)
- [`reboot`](#reboot)
- [Failure](#failure)
- [What `plan` can and cannot show](#what-plan-can-and-cannot-show)

<!-- tocstop -->

```ts
interface Host {
  readonly name: string // the host script's name, e.g. "sonarr"
  read(cmd: string, options?: CommandOptions): Promise<string>
  inspect(cmd: string, options?: CommandOptions): Promise<InspectResult>
  file(path: string, content: string | Uint8Array | Blob, options?: FileOptions): Promise<ChangeStepResult>
  link(path: string, target: string, options?: LinkOptions): Promise<ChangeStepResult>
  ensure<T extends string | boolean>(name: string, options: EnsureOptions<T>): Promise<ChangeStepResult>
  run(
    name: string,
    cmd: string | ((tools: ChangeTools) => Promise<void>),
    options: RunOptions,
  ): Promise<ChangeStepResult>
  reboot(options: RebootOptions): Promise<ChangeStepResult>
}

// Tools that only read the host, given to a check function. These are the same as `h.read` and `h.inspect`.
type ReadTools = { read: Exec; inspect: Inspect }

// Tools that can change the host, given to a fix or run function.
type ChangeTools = { exec: Exec; inspect: Inspect }

// Runs one command and returns its stdout. A check gets it as `read`, and a fix or run function as `exec`.
type Exec = (cmd: string, options?: CommandOptions) => Promise<string>

// Runs one command and returns its output and exit code, without failing on a non-zero exit.
type Inspect = (cmd: string, options?: CommandOptions) => Promise<InspectResult>

type CommandOptions = {
  secret?: boolean // keep the command and its output out of the output and errors
}

type InspectResult = {
  stdout: string // trimmed
  stderr: string // trimmed
  exitCode: number
}

type ChangeStepKind = "file" | "link" | "ensure" | "run" | "reboot"

// What a change step returns.
type ChangeStepResult<K extends ChangeStepKind = ChangeStepKind> = {
  name: string // shown when another step needs this one
  kind: K // the method on `h` that ran it, like "ensure" or "run", so `needs` can refuse a run's result
  changed: boolean // the step changed something, would change it in plan, or waits on a step it needs
}
```

`changed` is what lets a script react to a step, as in `h.run(..., { after: [unit] })`. In plan mode it means
"would change", so the follow-up shows up in the plan as a `>` line exactly when it would run for real.

Scripts only see `changed`. They cannot tell a real change from a would-be one, so they cannot branch on the mode and
make the plan differ from what `apply` does. The output shows each step's full status: unchanged, changed, would change,
waiting, or failed.

## Choosing a method

An `ensure` is the if statement you would write without `plan`, like `if (!(await isInstalled())) await install()`.
The difference is that tsinfra gets the condition and the body separately. That lets it run only the condition in
`plan`, run the condition again after the body in `apply`, and count a condition that did not pass as drift.

So plain TypeScript control flow is fine in a host script, except for one decision: whether a change is needed. That
decision belongs in how a step reads the host's state, where tsinfra can see it.

| When the code...                       | Use                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| changes state that can be checked      | [`ensure`](#ensure), or [`file`](#file) or [`link`](#link) for a file or a symlink |
| follows up on a change, or always runs | [`run`](#run) with `after`                                                         |
| picks which steps apply                | [`read`](#read) or [`inspect`](#inspect), plus an `if`                             |

A fact that picks steps is one that no step on the host changes, like the CPU architecture or whether the host is a
container. Branching on state that an earlier step changes runs into
[what `plan` cannot show](#what-plan-can-and-cannot-show).

Read a fact at the top level, and use it inside a step through the closure. A fact doesn't change during the run, so
reading it once is enough, even when it only shapes one step, like the CPU architecture in a download URL. A step's
function can't call `h`, so a one-off command that only a fix needs goes through the fix's own tools instead, and is
recorded under that step.

The wrong shape for a change is a read, an `if`, and a `run`:

```ts
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) await h.run("Install docker", installDocker, { after: "always" })
```

It mostly works. `plan` runs the inspect and shows the run when docker is missing. What it loses is the check after the
fix, the drift exit code, and the step's line in verbose output when docker is already there. Nothing looks broken,
which is why the table matters. The same step as an `ensure`:

```ts
await h.ensure("Install docker", { check: "command -v docker", want: true, fix: installDocker })
```

## Commands

Everything that runs on the host takes one command at a time, so you never have to write a multi-line shell script.
Shell is for basic commands like `systemctl` or `docker compose`. Work out values in TypeScript, not with pipes and
`cut`.

Two shapes follow from that:

- **Computing a value** (a step's `check`) takes a command, or a function given `read` and `inspect` that returns the
  value. The function calls them as many times as it needs. It also runs during `plan`, so it must not change what the
  script manages.
- **Changing the host** (a step's `fix`, and `run`) takes a command, or a function given `exec` and `inspect`. The
  function calls `exec` once per command that changes the host. It only runs in `apply`.

**Let commands print.** Don't add `-q`, `--quiet`, or `>/dev/null` just because nothing reads a command's output.
tsinfra records every command's output under its step, and the report shows none of it by default, so quieting a
command only hides it from `-vvv` and from a failure's error, which is when you'd want it. Keep a quiet flag only where
it changes the output a script uses, like `docker compose ps -q` printing only container IDs.

`read`, `inspect`, and `exec` are the tools. Each runs one command and takes `CommandOptions`. `read` and `exec` return
stdout and fail on a non-zero exit. `inspect` never fails on a non-zero exit, for a command whose exit code or stderr is
the answer.

Every output a script gets back is trimmed of leading and trailing whitespace, because that is what a script usually
compares to. That covers `read`, `exec`, and both streams from `inspect`, on `h` and as tools. tsinfra's own comparison
for a string `want` strips only trailing newlines, so stray spaces in the real value still count as drift.

`read` and `exec` behave the same, and the name says which mode the function runs in. A check function also runs in
`plan`, so it gets `read` and `inspect`, the same pair `h` has. A fix or run function only runs in `apply`, so it gets
`exec` and `inspect`. Each function gets one tool that fails on a non-zero exit and one that does not. A function gets
its tools in an object, as in `async ({ read }) =>` or `async ({ exec }) =>`, so tools can be added later without
changing existing scripts. `exec` is not `h.run`. A run is a
step with its own name in the output, and a command inside a fix is part of one change that the step's name already
covers.

**An option takes a function when tsinfra decides when, or whether, it runs.** `check` runs in both modes and again
after the fix. `fix` and a run's command run only in `apply`, and only when needed. Every other option is a plain value
that your script computes before the call: `want`, `needs`, `after`, and `file`'s `content`. A `want` that depends on
the host belongs in the check, which reads both values and returns the comparison. `h.read` and `h.inspect` run
straight away, so they take a command, not a function. Combining several reads is ordinary code at the top level.

**A function holds commands, not decisions.** A fix or run function that tests the machine before acting is an
`ensure` step in disguise (see [`run`](#run)).

**`h` is for the top level.** Inside a check, fix, or run function, use only the tools the function is given.
Every method on `h` fails the host while another step is running, with an error like `'read' can't run while ensure step
'A' is running`. A read's name is its command, as in `read step 'uname -m'`. That
rules out these mistakes:

- **A step inside a step.** A step inside a fix never shows in `plan`, because `plan` never runs the fix. A step inside
  a check runs its fix while checking.
- **`h.read` or `h.inspect` inside a step's function.** The function's own tools do the same job, so there is one way
  to run a command inside a step.
- **Steps side by side.** Steps on one host run one at a time, so `Promise.all` over steps fails as soon as the second
  one starts. That includes reads. Commands inside one step can still run at once, with `Promise.all` over `exec` in a
  fix.

A check function runs in `plan`, so a mistake there shows up on the first `plan`. A fix or run function only
runs in `apply`, so a mistake there shows up in `apply`.

## Steps

A step is one call on `h`. A host function is a series of steps, run one at a time at the top level of the script.
There are two kinds:

- **Read steps** tell the script about the host, and return what they found. They're [`read`](#read) and
  [`inspect`](#inspect).
- **Change steps** can change the host, whether or not they do, and each returns a `ChangeStepResult`. They're all the
  others.

Most change steps read one piece of the host's state, and in `apply` run a fix when it differs.
`ensure` is the step where you write how to read it, as its `check`. [`file`](#file) and [`link`](#link) are steps that
read the state themselves. [`run`](#run) is a step that reads no state.

Name a step like a function, starting with a verb ("Install Caddy"), or as the state it ensures ("Caddy is installed").
Both read well after `ensure`.

## `read`

Runs a command on the host in both modes and returns its output, trimmed. Each `h.read` is a step of its own. It has
no name, so errors and verbose output show its command. It is for observations a script branches on:

```ts
const arch = await h.read("uname -m")
const firewall = await h.read("sudo ufw status")
```

A non-zero exit fails the host, with the command's stderr. When the exit code or stderr is the answer, use
[`inspect`](#inspect). A `read` must not change what the script manages, because it also runs during `plan` (see
[what a check may change](#what-a-check-may-change)). Nothing can enforce that.

`secret: true` keeps the command out of errors and output, for a command that carries a token. The output itself is
only ever returned to the script.

## `inspect`

Runs a command on the host in both modes and returns its stdout, stderr, and exit code. It never fails on a non-zero
exit, so it suits a command whose exit code is the answer, and one that prints the answer on stderr, like
`java -version`. Like `read`, it is a step of its own with no name, and it must not change what the script manages.

```ts
const container = await h.inspect("systemd-detect-virt --container")
if (container.exitCode !== 0) await tuneKernel(h)
```

Check, fix, and run functions get an `inspect` tool too. A command that could not run at all, like one on an unreachable
host, still fails the host.

`read` stays the default and keeps returning a string, because most reads only want stdout, and a failed `read` means
something is broken. An option on `read` that changed its return type would need overloads.

## `file`

```ts
type FileOptions = {
  mode?: FileMode // "644", "rw-r--r--", or a constant like PUBLIC_FILE_MODE. Managed only when given
  user?: string | number // a name is compared with the user's name, a number with its uid
  group?: string | number // a name is compared with the group's name, a number with its gid
  sudo?: boolean // run the file details command, the diff, and the write as root
  secret?: boolean // never fetch or show the old content
  overwrite?: boolean // default true. false writes the content only when the file is missing
  validate?: (tempPath: string) => string // a command that checks the new content before it replaces the file
  needs?: ChangeStepResult<"file" | "link" | "ensure">[]
}
```

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
await h.file("/etc/caddy/Caddyfile", Bun.file(path.join(FILES, "Caddyfile")), { sudo: true })
await h.file("/etc/motd", "Welcome to sonarr\n")
```

Writes `content` to `path` on the host, and reports whether it changed. `content` is a string or bytes computed on the
control machine, or a `Blob` like `Bun.file(...)` for a file there. Every option is optional, so the simplest call is a
path and its content. The step is named by its
path, and returns a `ChangeStepResult<"file">`, so a run can follow it and a later step can need it. A symlink is a step of
its own, [`link`](#link).

**Content from a file on the control machine.** Pass `Bun.file(path)`, which is a `Blob`, not a string. A string is
always the content itself, so it can't be mistaken for a path. tsinfra reads the `Blob` inside the step:

- **A missing file fails the step,** like `failed to read local file '/repo/files/Caddyfile'`, not the script.
- **Its size is known before reading,** from `blob.size`, so the [size limit](#the-write) fails before anything is read.
- **It leaves room for streaming.** `blob.stream()` is how large files could be sent without holding them in memory
  (see [Open questions](./open-questions.md#files-over-10-mb)).

A file that needs values filled in is read and edited in the script, then passed as a string, like any template.

`Bun.file("files/x")` resolves a relative path against the directory tsinfra runs from. Build paths from the script's own
location instead, so they work from anywhere. One file in the repo can hold them:

```ts
// lib/paths.ts
import path from "node:path"

export const ROOT = path.resolve(import.meta.dir, "..")
export const FILES = path.join(ROOT, "files")
```

tsinfra doesn't provide these, because only the repo knows its own layout, and `import.meta.dir` already resolves from
the file itself.

**Modes.** `mode` takes octal, like `"644"` or `"4755"`, or the symbolic form `ls -l` prints, like `"rw-r--r--"`,
with `s`/`S` and `t`/`T` for setuid, setgid, and the sticky bit. Both are template literal types, so a typo like `"648"`
or `"rw-r--r-"` fails to type-check. chmod's `u=rw,g=r` form isn't supported, because its `+` and `-` are relative to the
current mode, and a step states the mode it wants. A changed mode shows both notations, whichever one the script wrote, like
`rw------- (600) -> rw-r--r-- (644)`. tsinfra exports named modes, each a symbolic string, so hovering one shows its permissions:

| Constant                  | Mode        | Octal | For                                        |
| ------------------------- | ----------- | ----- | ------------------------------------------ |
| `PUBLIC_FILE_MODE`        | `rw-r--r--` | `644` | Most config files                          |
| `GROUP_FILE_MODE`         | `rw-r-----` | `640` | A secret a service reads through its group |
| `PRIVATE_FILE_MODE`       | `rw-------` | `600` | Keys, tokens, and other secrets            |
| `PUBLIC_EXECUTABLE_MODE`  | `rwxr-xr-x` | `755` | Scripts and binaries                       |
| `GROUP_EXECUTABLE_MODE`   | `rwxr-x---` | `750` | A script only a group may run              |
| `PRIVATE_EXECUTABLE_MODE` | `rwx------` | `700` | A script only its owner may run            |

**Defaults.** `mode`, `user`, and `group` are managed only when given. An existing file keeps its own otherwise, the
way Ansible, Salt, Chef, and Puppet all do, so a `file` step never loosens a `0600` file or takes ownership away from an
app. A new file gets mode `644`, or `600` with `secret`, and is owned by whichever user ran the write: the SSH user, or
root under `sudo`.

**Paths.** A path must be absolute, starting with `/` or `~/`. A relative path fails, like `must be an absolute
path, starting with / or ~/ (was "app.conf")`, because it would land wherever the shell starts. A leading `~/` means the
connecting user's home on the host, even under `sudo`. A path goes into every
command fully single-quoted, with each `'` written as `'\''`, so a space or a quote can't break the command. Quoting
also stops the shell from expanding `~`, which only happens when `~` is unquoted at the start of a word. So tsinfra
resolves `~/` itself:

- **It reads the home directory when the host is prepared,** before the script runs, as the SSH user, with
  `printf '%s' "$HOME"`. That's one command per host, and it doubles as the first contact with the host, so a host that
  can't run commands fails before its script starts. It runs without `sudo`, because under `sudo` the shell's `$HOME` is
  usually root's. `printf '%s'` prints the value exactly, and avoids the way some shells treat backslashes or `-n` in
  `echo`.
- **It replaces the leading `~/` with that path,** then quotes the whole path. Every command `file` builds uses a plain
  absolute path, the same with or without `sudo`. A bare `~` means the home directory itself. [`link`](#link) gets
  the same treatment, for its path and its target.
- **An empty or relative `HOME` is an error,** like `can't resolve ~/ in '~/.config/fish/config.fish', because $HOME
  isn't set on the host`. `printf` prints nothing whether `HOME` is unset or empty, so one check covers both. The check runs only for a path that
  uses `~`, so a host without `HOME` still runs a script that doesn't. Over
  SSH, sshd sets `HOME` from the user's account, so this only happens when tsinfra itself runs without one. A `HOME` of
  `/` is odd but valid, so it's allowed.
- **`~otheruser/` is an error,** because it isn't an absolute path. Resolving another user's home would need an
  account lookup that nothing needs yet.

The shell's own `~` is just `$HOME` too. POSIX leaves the result unspecified when `HOME` is unset, and shells differ:
bash, zsh, and macOS `/bin/sh` fall back to the account database, while dash and busybox sh leave `~` in place, which
would quietly make a directory named `~`. Reading `$HOME` ourselves turns that into an error. pyinfra leaves a leading
`~/` unquoted so the shell expands it, and runs `sudo -H`, so under sudo its `~` means root's home. That suits pyinfra,
which can sudo to any user. tsinfra only escalates to root, where `~` as `/root` is rarely what a script means.

**Symlinks and other non-files are refused.** If `path` is a symlink, a directory, or anything but a regular file, the
step fails, like `'/etc/x' is a symlink, so file won't replace it`. Managing a link is what [`link`](#link) is for.
Whether `file` should follow a link and write to its target is open (see
[Open questions](./open-questions.md#following-symlinks-in-file)).

### Reading the state

One command prints what tsinfra needs, or a marker for a path that isn't a regular file:

```sh
if [ -L "$p" ]; then echo kind=link
elif [ ! -e "$p" ]; then echo kind=absent
elif [ ! -f "$p" ]; then echo kind=other
else
  echo kind=file
  { command -v sha256sum >/dev/null 2>&1 && sha256sum < "$p"; } ||
  { command -v shasum >/dev/null 2>&1 && shasum -a 256 < "$p"; } ||
  { command -v sha256 >/dev/null 2>&1 && sha256 < "$p"; } ||
  { echo 'failed to get the sha256 hash of the file on the host' >&2; exit 1; }
  stat -c '%a %u %g %U %G %s' "$p" 2>/dev/null || stat -f '%Mp%Lp %u %g %Su %Sg %z' "$p"
fi
```

- **The hash is sha256,** the default in Salt, Chef, and Puppet. POSIX has no sha256 command, so the file details command tries each
  common one: `sha256sum` (GNU coreutils, busybox, current macOS), `shasum -a 256` (older macOS), and `sha256` (FreeBSD,
  OpenBSD). This is the same chain pyinfra uses. It checks that each one exists first, so a missing one writes nothing
  to stderr. One that exists and fails keeps its stderr, and the next one still runs. The file goes in on stdin, because GNU `sha256sum` escapes odd
  filenames in its output and prefixes the line with `\`. tsinfra reads the first 64 hex characters, because GNU,
  busybox, and `shasum` print `<hash>  -` and BSD `sha256` prints the bare hash. When no command gives a hash, the
  script exits 1, because `stat` would otherwise exit 0 and hide the failure. Every answer the script gives exits 0, so
  a non-zero exit always means it broke, and the error holds its stderr: the stderr of any command that exists and
  failed, then `failed to get the sha256 hash of the file on the host`.
- **`stat -c` goes first,** because GNU's `stat -f fmt file` doesn't fail. It prints filesystem information instead.
  BSD needs `%Mp%Lp`, because `%Lp` alone drops setuid and setgid.
- **The local hash** comes from `Bun.CryptoHasher("sha256")`. No file is transferred just to learn it is unchanged.
- **The file is in sync** when the hash matches, and so does each attribute that was given. Modes are compared as octal
  numbers, because GNU prints `644` and BSD prints `0644`. A user or group given as a name is compared with the name
  `stat` prints, and one given as a number with the uid or gid. There's no portable command to turn a group name into
  its id, because `getent` is Linux-only and macOS uses `dscl`, so names stay names. GNU and busybox print `UNKNOWN` for
  an id with no name, which only matters for an id, and those are compared as numbers.
- **Verification** reads the state again after the write, through `converge`. A file still out of sync fails with
  "the host's state still differs after the fix", with the details under it.

### The diff

When the hashes differ, a second command fetches the old content with `cat`, so the step's line can show a diff (see
[CLI](./cli.md#how-the-report-is-built)). It skips that fetch, and shows a `content:` line instead, in these cases:

| Case                                                | Line                                           |
| --------------------------------------------------- | ---------------------------------------------- |
| The file doesn't exist yet                          | `content: new file, 2.05 kB`                   |
| `secret: true`                                      | `content: hidden, 1.2 kB -> 1.3 kB`            |
| Either side is binary: a NUL byte, or invalid UTF-8 | `content: binary, 12 kB -> 14 kB`              |
| Either side is over 100 kB                          | `content: too large to diff, 300 kB -> 310 kB` |

Sizes use SI units, 1 kB = 1000 bytes, the way npm and most file managers show them. A size under 1 kB is spelled
out, like `15 bytes`, because a lone `B` reads like "billion". The words are italic, and the sizes are colored like
`got` and `want`, old in red and new in green. Every `content:` line ends with
the sizes, old to new, or just the new size for a new file. The sizes come from `stat`, so a `secret` file shows them
without its content being fetched.

With `secret`, tsinfra never runs `cat` and never prints a full hash. The 100 kB limit follows Ansible, which caps its
diff at about 100 kB. A changed attribute shows on a line of its own, old value to new, lined up with any `content:`
line:

```
  ~ change: (file) /etc/app/app.conf
       3  port = 8080
         -workers = 4
       4 +workers = 8
       5  log = info
      mode: rw-r--r-- (644) -> rw------- (600)
      user: root -> sonarr
```

### The write

The write is one script, run on the host. Content travels inside it, base64-encoded in a heredoc, and lands in a temp
file next to the destination, which one rename puts in place. See [Transport](./transport.md#file-writes) for the
script and why each step comes in its order. The destination is only ever the old file or the complete new one, already
with its owner and mode.

**Size limit.** Content over 10 MB fails before anything is read or sent, like `local file '/srv/app.iso' is 14 MB, above the 10 MB limit`. The
shell holds the whole script in memory, and base64 adds a third, so the heredoc suits config files, not large binaries.
A streaming path for large files is open (see [Open questions](./open-questions.md#files-over-10-mb)).

**Content written only once.** `overwrite: false` creates a missing file, and never rewrites its content after that.
It's for a file an app rewrites itself, like Sonarr's `config.xml`, which changes whenever a setting changes in its web
UI. Managed normally, every `plan` would show that as drift, and every `apply` would undo the UI's changes:

```ts
await h.file("/var/lib/sonarr/config.xml", sonarrConfig, { user: "sonarr", mode: "600", overwrite: false })
```

- **An existing file's content is never read or compared,** so it shows no diff and never counts as drift.
- **A missing file** shows as `content: new file` in `plan`, and gets written in `apply`, as usual.
- **`mode`, `user`, and `group` are still managed** every run, like Puppet's and Salt's `replace: false`.
- **The name** is fs-extra's `overwrite`, the usual JavaScript word for it. "Replace" already means swapping one kind
  of thing for another in `file`'s refusals.

**Validation.** `validate` runs a command against the temp file before the rename, so a broken config never replaces a
working one. A bad `sshd_config` or sudoers file can lock tsinfra out of the host for good:

```ts
await h.file("/etc/ssh/sshd_config", sshdConfig, { sudo: true, validate: (tempPath) => `sshd -t -f ${tempPath}` })
await h.file("/etc/sudoers.d/adam", sudoers, {
  sudo: true,
  mode: "440",
  validate: (tempPath) => `visudo -cf ${tempPath}`,
})
```

- **It takes a function,** given the temp file's path already shell-quoted, so there's no placeholder like Ansible's
  `%s` to learn or forget.
- **It runs as the write does,** under `sudo` with `sudo: true`.
- **A non-zero exit fails the step.** The temp file is deleted and the old file stays as it was, like
  `the new content of '/etc/ssh/sshd_config' isn't valid -> exited with code 255: line 3: Bad configuration option: Foo`.
- **The temp file keeps the destination's extension,** like `.app.a1b2c3.json` for `app.json`, because some validators
  pick a parser by extension.
- **It only runs in `apply`.** `plan` never writes the temp file, so invalid content shows up on the first `apply`.
- **It checks the file on its own.** A fragment that only makes sense with the rest of a config, like an nginx site,
  is checked by a `run` after the file instead, like `nginx -t && systemctl reload nginx`.

### `sudo` and permissions

`file` runs as one user from start to finish, with no upload-then-move hop:

| Option       | Runs as                   | For                                                            |
| ------------ | ------------------------- | -------------------------------------------------------------- |
| no `sudo`    | the SSH user, via `sh -s` | files the SSH user can write, like anything under `~`          |
| `sudo: true` | root, via `sudo`          | files under `/etc`, root-only files, or another user as `user` |

Under `sudo: true`, every part runs as root: the file details command, the `cat` for the diff, and the write. tsinfra writes all of
those commands, so there is nowhere for a script to add `sudo` itself. This means `plan` also needs sudo on a host that
manages such a file, and a host whose sudo needs a password declares it on `host()` (see
[Transport](./transport.md#sudo)).

`sudo` isn't the default, because a file written as root under `~` would end up owned by root, and because a host that
never escalates shouldn't need sudo set up. A `file` step only escalates when it asks to.

Three mistakes get errors of their own instead of a raw shell error. For the first two, tsinfra runs `id` to see who
runs the step's commands, which is root under `sudo`. They only fail when a write is coming, so a file already in sync
passes, and they show in `plan` too:

- **`user` names another user without `sudo`,** like `user 'sonarr' needs sudo: true, because only root can change a
  file's owner to another user`. Only root can `chown` a file to someone else.
- **Someone else owns the file, and no `user` is given, without `sudo`,** like `'/etc/app.conf' is owned by 'sonarr', so
  writing it needs sudo: true`. A write keeps the file's owner with `chown`, which needs the same permission.
- **The file details command can't read the file without `sudo`,** like `can't read '/etc/shadow' as the SSH user, so it needs sudo:
  true`. That way an unreadable file doesn't look missing.

## `link`

```ts
type LinkOptions = {
  user?: string | number // a name is compared with the user's name, a number with its uid
  group?: string | number // a name is compared with the group's name, a number with its gid
  force?: boolean // replace a regular file or an empty directory at the path
  sudo?: boolean // read and make the link as root
  needs?: ChangeStepResult<"file" | "link" | "ensure">[]
}
```

```ts
// The file at ~/.config/fish/config.fish links to the repo's copy.
const fishConfig = new URL("../dotfiles/fish/config.fish", import.meta.url).pathname
await h.link("~/.config/fish/config.fish", fishConfig)
```

Makes `path` a symlink to `target`, and reports whether it changed. This is how dotfiles in a repo can be linked into
place on the control machine, so an edit in the repo shows up straight away. The step is named by its path, and its path
follows the same rules as `file`'s (see [`file`](#file)).

`link` is a step of its own, not a form of `file`, because the two share only the path and the owner. A link has no
content, mode, or `secret`, and `force` means nothing for a regular file. Their state commands, output, and writes
differ too.

The words are easy to mix up. In `ln -s TARGET LINK`, the target is the original file the link points to, and the link
is the new path. `h.link` takes them the other way around, `path` then `target`, because every step names the path it
manages first.

- **The target is a path on the same host as the link.** A symlink stores a path, and the system looks it up wherever
  the link lives. For `@local`, that is the control machine, so a link into the repo works. On a remote host, a link
  points at that host's own files, like `/etc/nginx/sites-enabled/app` to `/etc/nginx/sites-available/app`.
- **The target must be absolute,** starting with `/` or `~/`. A relative target is resolved from the link's own
  directory, every time the link is followed, not from where the script runs. That is the classic mistake: a link to
  `dotfiles/config.fish` made from the repo looks for `~/.config/fish/dotfiles/config.fish`. A relative target fails
  with `target must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's
  directory`. `~/` means the SSH user's home, as it does for `path`. All six tools compared in
  [Transport](./transport.md#file-writes) allow a relative target. Refusing one now can be loosened later without
  breaking a script, and the reverse can't.
- **The target may not exist yet,** because a later step might create it, or a mounted drive might not be there. The
  link is still made, with a `warning: nothing exists at target -> <target>` line under it, so a typo in the repo path stands out.
  The warning shows even when the link is already right, without `--verbose`, and the summary counts it. It's not
  drift, so it doesn't change the exit code.
- **The state command** reads the existing link's target with `readlink` and compares it with `target` as an exact
  string, after `~/` is resolved. It is in sync when `path` is a symlink that points there, with the right owner.
- **An existing symlink is always updated** to point at `target`, because managing it is the point.
- **A regular file at `path` is an error** unless `force: true`, like `'/home/adam/.config/fish/config.fish' is a
  regular file, so link won't replace it without force: true`. This is the first run for dotfiles, where the real file
  still sits where the link will go. Move it into the repo, or set `force` to replace it. That is the same as `ln -f`,
  and there's no backup.
- **An empty directory at `path` is an error** unless `force: true`, like Ansible, because nothing can be lost.
- **A directory with anything in it is always an error,** even with `force`, because replacing it would throw away
  everything in it. A hidden file counts. Anything else that isn't a link or a regular file, like a socket, is always
  an error too.
- **`sudo` works as it does for `file`.** The state command and the write both run as root.
- **The output** shows `target: new link to /home/adam/dotfiles/fish/config.fish` for a new link, and a changed target
  as an attribute line, like `target: /home/adam/old -> /home/adam/new`. Paths are absolute, because that's what
  `readlink` gives back. Forcing something out shows `replaces a file` or `replaces an empty directory`.
- **The write** makes the link in a temp directory next to `path`, then renames it into place, so there is almost never
  a moment with nothing at `path`. The exceptions are a forced empty directory, and replacing a link to a directory on
  busybox (see [Transport](./transport.md#link-writes)).
- **`user` and `group` work as they do for `file`:** the value given, then what's at `path` now, then the default for
  something new. So do its errors for `user` naming another user, and for something someone else owns. There's no
  `mode`, because a symlink's mode doesn't apply to it. `chown -h` changes the link, not what it points to.
- **It returns a `ChangeStepResult<"link">`,** so `needs` and `after` accept it the same as a file's. A run can follow a link
  that changed.

## `ensure`

```ts
// `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string.
type EnsureOptions<T extends string | boolean> = {
  check: string | ((tools: ReadTools) => Promise<T>)
  // `true` means exit 0, or a function returning true, is already right. `false` means the opposite.
  // A string is compared to the command's stdout, or the function's value.
  want: T
  fix: string | ((tools: ChangeTools) => Promise<void>)
  verify?: boolean // default true
  secret?: boolean // hide the diff
  needs?: ChangeStepResult<"file" | "link" | "ensure">[] // earlier steps this step's check depends on
}
```

`check` runs on the host, and `want` is the answer it gives when the state is already right. When they match, nothing
happens. Otherwise the fix runs. `want` is always written out, so the rule a check follows is visible at the call site.
The field is `check`, not `read`, because `h.read` fails on a non-zero exit and a check never does.

**`want: true` or `false`** compares the exit status. `true` means exit 0 is already right, and `false` means a
non-zero exit is. There is nothing to diff, so `plan` shows only the step's name. `true` suits state that only answers
yes or no, like `brew bundle check`. `false` suits state that should be absent.

```ts
await h.ensure("Install Caddy", { check: "dpkg -s caddy", want: true, fix: "sudo apt-get install -y caddy" })
await h.ensure("Remove the old user", { check: "id olduser", want: false, fix: "sudo userdel olduser" })
```

**A string `want`** is compared to the command's stdout. `want` is computed in your script on the control machine.
Trailing newlines are stripped from both (the way `$(cmd)` does), then the two are compared exactly. Stripping `want`
too means a value built from a template literal that ends in a newline still matches. When they differ, the step's line
in `plan` and `apply` shows how: a `got:` and a `want:` line for a single-line value, or a line diff for a multi-line
one.

```ts
await h.ensure("Start Sonarr", {
  check: "systemctl is-active sonarr",
  want: "active",
  fix: "sudo systemctl enable --now sonarr",
})
```

A command check is shorthand for calling `inspect` in a check function, so a non-zero exit is an answer, not a failure.
`read` is the one that fails on a non-zero exit.

A broken check must not look converged. If the command exits non-zero and its output still equals `want`, the step fails
instead of reporting `unchanged`. A check whose non-zero exit is legitimate (`systemctl is-active` exits 3 for inactive)
already produces output that differs from `want`, so this only catches the broken case.

There is no number form for a specific exit code. `want: 0` would mean the same as `want: true`, and the cases that
need a specific code, like `systemctl is-active`, read better as output. It can be added later without breaking
anything.

**A check function** works out the answer in TypeScript, for state that is awkward to test in shell. It calls the
`read` and `inspect` it is given, and returns the value compared to `want`: a boolean for a boolean `want`, and a
string for a string `want`.

```ts
await h.ensure("Enable the app", {
  check: async ({ read }) => JSON.parse(await read("cat /etc/app/config.json")).enabled === true,
  want: true,
  fix: "...",
})

const latest = await latestCaddyVersion() // fetch() on the control machine
await h.ensure("Update Caddy", {
  check: async ({ read }) => (await read("caddy version")).split(" ")[0] ?? "",
  want: latest,
  fix: buildCaddy,
})
```

Return a string when the answer is a value, so a failure shows `got:` and `want:` lines instead of `got: false`. A
string `want` means equal, so a check that is not an equality returns a boolean, like a minimum version:

```ts
await h.ensure("Install Caddy 2.8 or newer", {
  check: async ({ inspect }) => {
    const { stdout, exitCode } = await inspect("caddy version")
    if (exitCode !== 0) return false
    // `caddy version` prints "v2.8.4 h1:...".
    const [version = ""] = stdout.split(" ")
    return Bun.semver.satisfies(version, ">=2.8.0")
  },
  want: true,
  fix: buildCaddy,
})
```

`inspect` makes a missing `caddy` mean the fix is needed. With `read`, the same check would fail as broken.

Parse output in TypeScript, not in shell. Avoid `read("caddy version | cut -d' ' -f1")`. It hides the parsing on the
host, and a `cut` that finds nothing still exits 0. Read the whole output and split it in the function, where the
parsing runs on the control machine and can be tested.

A check function gets the broken-check rule for free, because the `read` it is given throws on a non-zero exit. Like
any check, it also runs during `plan`, so it must not change what the script manages. If it throws, the step fails
with the step's name in the error.

### What a check may change

A check runs in `plan`, so it must not change anything the script manages, or `plan` would make the changes it's meant
to preview.

- **Refreshing metadata the check needs is fine.** `apt-get update` before listing upgrades only refreshes the list of
  what's available, and nothing installed or running changes. Without fresh lists, there's no way to answer the check.
- **Fetching or changing something a later step acts on breaks the rule.** `docker compose pull` moves the image tag
  on the host, so the next `docker compose up -d` from anywhere starts the new image, whether that's another step's fix,
  a manual command, or a restart after a reboot. `plan` would quietly stage an upgrade nobody applied. It also downloads
  on every `plan`, and each pull counts against Docker Hub's pull limit. Reading the registry's digest answers the
  same question without any of that.

Nothing enforces this, so a script can still choose to break it, knowing the cost (see the recipes).

Read inside the function, not before the step. The check runs again after the fix (see [Verification](#fix)). A value
read before the step would still hold the state from before the fix, so the step would fail even when the fix worked.

### `fix`

`fix` is one command, or a function that runs several commands by calling `exec`. The function form is for one change
that takes more than one command, where the halfway state is not something you would check:

```ts
await h.ensure("Install Caddy", {
  check: "dpkg -s caddy",
  want: true,
  fix: async ({ exec }) => {
    await exec("sudo apt-get update")
    await exec("sudo apt-get install -y caddy")
  },
})
```

Each `exec` call runs one command and returns its stdout, trimmed. A non-zero exit throws, which stops the fix there,
and the error names the command. That replaces `set -e` or `&&` chains, and it puts TypeScript between the commands. A
later command can use an earlier one's output:

```ts
fix: async ({ exec }) => {
  const id = await exec(`docker create ${image}`)
  await exec(`docker cp ./seed ${id}:/data`)
  await exec(`docker start ${id}`)
}
```

The fix function only runs in `apply`, so it can change things and do work on the control machine.

**One step or several.** A fix re-runs every command whenever its check fails. If one command's effect can be in place
while the check still fails, that effect is state of its own, and it gets its own step. In the apt example, an updated
package index does not matter, so running `apt-get update` again is harmless. This one is wrong:

```ts
await h.ensure("Set up Sonarr", {
  check: "systemctl is-active sonarr",
  want: "active",
  fix: async ({ exec }) => {
    await exec("sudo useradd --system sonarr")
    await exec("sudo install -d -o sonarr /var/lib/sonarr")
    await exec("sudo systemctl enable --now sonarr")
  },
})
```

If `systemctl` fails, the next run starts the fix from the top, and `useradd` fails because the user already exists, so
the step can never finish. The check only covers the last piece, so a data dir with the wrong owner still reports
`unchanged`. `plan` shows one line that does not say what is missing. Written as three steps, each piece has its own
check, and each fix runs only when its own state is wrong:

```ts
await h.ensure("Create the sonarr user", { check: "id sonarr", want: true, fix: "sudo useradd --system sonarr" })
await h.ensure("Create the sonarr data dir", {
  check: "stat -c %U /var/lib/sonarr",
  want: "sonarr",
  fix: "sudo install -d -o sonarr /var/lib/sonarr",
})
await h.ensure("Start Sonarr", {
  check: "systemctl is-active sonarr",
  want: "active",
  fix: "sudo systemctl enable --now sonarr",
})
```

There is no list form of `fix`. A multi-line string runs like any shell script, so it carries on past a failed line
unless it starts with `set -e`. Use the function form for anything past one command.

**`sudo`** goes in the command itself, only where it's needed, like `fix: "sudo apt-get install -y caddy"`. On a host
that needs a sudo password, tsinfra supplies it (see [Transport](./transport.md#sudo)).

**Verification.** After a fix runs, the check runs again. If it still does not pass, the step fails with "the host's
state still differs after the fix", followed by a `got:` and a `want:` line, or a line diff for a
multi-line string. A string is quoted, so an empty value shows as `''`. A boolean shows as `true` or `false`. An exit
status shows as `exit code 1`, against `exit code 0` or `a non-zero exit code`. A `stderr:` row follows for the fix and
the check when each ran one command that printed some, and names that command (see
[CLI](./cli.md#output)). A step that reports a change on every run is a bug, and this is what surfaces it the first time.

```
the host's state still differs after the fix
  got:  exit code 0
  want: a non-zero exit code
```

`verify: false` skips the check after the fix, and the step reports `changed` as soon as the fix succeeds. It is for a
fix whose effect nothing in the run can make visible, like one that needs a reboot or a new desktop login. The next
run's check confirms it. Before reaching for it, try these:

- **Make the change take effect in the fix.** If one more command makes the effect visible, the fix runs it too. A
  resized swap file only shows in `swapon --show` once it is switched back on:

  ```ts
  await h.ensure("Resize swap", {
    check: "swapon --show=SIZE --noheadings --raw",
    want: "8G",
    fix: async ({ exec }) => {
      await exec("sudo swapoff /swapfile")
      await exec("sudo fallocate -l 8G /swapfile")
      await exec("sudo mkswap /swapfile")
      await exec("sudo swapon /swapfile")
    },
  })
  ```

- **Refresh after the step that needs it.** When another step's change needs a refresh, the refresh is a `run` after
  that step, not part of a later fix. `systemctl daemon-reload` follows the unit file it applies, so a unit change
  reloads even when the service is already running:

  ```ts
  const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit] })
  await h.ensure("Start Sonarr", {
    check: "systemctl is-active sonarr",
    want: "active",
    fix: "sudo systemctl enable --now sonarr",
  })
  ```

- **Check the stored state, not the current session.** After `usermod -aG docker sonarr`, plain `id` in an existing
  session does not show the group until a new login. `id -nG sonarr` reads the user database and shows it straight
  away.

**Plan mode** runs the check and never the fix. A step that would change reports `changed`.

## `run`

```ts
type RunOptions = CommandOptions & {
  after: ChangeStepResult<"file" | "link" | "ensure" | "run" | "reboot">[] | "always" // run when any of these changed, or "always" on every pass
}
```

A step with no check: one command, or a function given `exec` for one action that takes several commands. `secret`
applies to a string command, and a function passes it to each `exec`. Write `sudo` inside the command where it's needed.

A run is for work that something in this run triggers, not the host's state. There are two kinds, and both go in
`after`, which is required, so a forgotten trigger is a type error:

- **A follow-up to a change** takes `after`, the results of the steps it follows. It runs when any of them changed.
  Restarting a service after its config changed is one. No state on the host says a restart is needed, because a
  process started before the change looks the same as one started after it.
- **Unconditional upkeep** takes `after: "always"`, like `docker system prune -f`. A check for "anything to prune?"
  would cost as much as pruning.

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
const timer = await h.file("/etc/systemd/system/sonarr-backup.timer", backupTimer, { sudo: true })

await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit, timer] })
await h.run("Prune docker", "docker system prune -f", { after: "always" })
```

`after` only takes results from steps that can change the host, so a value from `h.read` cannot be a trigger. A step
that only runs on some code paths goes in the same `if` as the run that follows it, so the run never refers to a step
that didn't happen.

**Put a run right after the steps it follows.** tsinfra keeps no state, so a trigger that didn't get its run is lost. If
a unit file changes and the host fails before its reload runs, the next `apply` finds the file already right and
reports it unchanged, so the reload never fires on its own. With the run right after its steps, the only gap left is the
run itself failing. When a run with `after` fails, its error ends with a hint, like
`the steps it follows won't show as changed on the next apply, so run this by hand once it's fixed`.

|                       | `apply`                           | `plan`                                   |
| --------------------- | --------------------------------- | ---------------------------------------- |
| `after`, one changed  | runs, reports `ran`               | does not run, reports `ran` (a `>` line) |
| `after`, none changed | does not run, reports `unchanged` | does not run, reports `unchanged`        |
| `after: "always"`     | runs, reports `ran`               | does not run, reports `ran` (a `>` line) |

A `ran` step returns `changed: true` in `plan` too, so one `run` can follow another (`after: [reload]`), and the plan
shows the chain exactly as it would run for real.

A condition based on a fact, like the CPU architecture, is an `if` around the `run`, the same as for any other step.
Prefer `after` over wrapping a run in `if (unit.changed)`. They decide the same thing, but with `after` tsinfra still
knows the run exists when nothing changed, so verbose output can list it.

**Why a run is not an `ensure`.** A run is an `ensure` whose check is "did a trigger fire", with two differences:

- **There is no check after the fix.** "The unit changed" is still true after the reload, so the check would fail
  again and the step would fail.
- **It never counts as drift** (see [CLI](./cli.md#exit-codes)). An `"always"` run's check would never pass, so
  `plan` would exit 2 on every run. A follow-up only fires when a step it follows changed, and that step already counts.

Two actions are usually two runs, each with its own name in the output. The function form is for one action that takes
several commands under one trigger:

```ts
await h.run(
  "Update the stack",
  async ({ exec }) => {
    await exec("docker compose pull")
    await exec("docker compose up -d")
  },
  { after: [compose] },
)
```

A function that takes `h` shares steps between hosts:

```ts
const updateComposeStack = async (h: Host, after: ChangeStepResult[]) => {
  await h.run("Pull images", "docker compose pull", { after })
  await h.run("Start the stack", "docker compose up -d", { after })
}

await updateComposeStack(h, [compose])
```

The same works for steps with a check, as in `aptPackage(h, "caddy")`. Helpers like these are how tsinfra gets modules,
whether you write them or tsinfra ships them (see [Open questions](./open-questions.md#helpers-worth-shipping)).

Anything that can be checked should be an `ensure`, not a `run`. `after` keeps a check out of the trigger, but one can
still hide in a run function:

```ts
await h.run(
  "Set up sonarr",
  async ({ exec }) => {
    if ((await exec("id -u sonarr || true")) === "") await exec("sudo useradd --system sonarr")
  },
  { after: "always" },
)
```

It works, but it never counts as drift, and `plan` shows it whether or not anything would change. Nothing can stop it,
because a function can run any code.

## `reboot`

```ts
type RebootOptions = {
  after: ChangeStepResult<"file" | "link" | "ensure" | "run" | "reboot">[] | "always" // the same as a run's
  timeout?: number // milliseconds to go down and come back, default 10 minutes
}
```

```ts
const kernel = await h.ensure("Install the HWE kernel", { ... })
await h.reboot({ after: [kernel] })
```

Reboots the host, waits for it to come back, and carries on with the script. Running `reboot` with `exec` would drop the
connection, so the command would look failed, and nothing would wait for the host. A reboot is a follow-up to a change,
not state a check can read, so it works like a [`run`](#run):

- **`after` decides when.** It reboots when a step it follows changed, or on every pass with `"always"`. In `plan` it
  never reboots, and shows as a `>` line, so later steps are checked against the host as it is, like any step after a
  change.
- **How it works.** It reads the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl -n kern.boottime` on
  macOS), starts `sudo reboot` in the background so the command returns cleanly, drops the ControlMaster socket, and
  polls until the host answers. Then it reads the boot id again. An unchanged boot id fails the step with
  `the host didn't reboot`, so a host that never went down doesn't count, the same check Ansible's `reboot` makes.
- **One `timeout`** covers going down and coming back. Ansible splits it in two, which mostly helps it word its errors.
- **It escalates like any command,** through the `sudo` function, so a host whose sudo needs a password declares it on
  `host()` (see [Transport](./transport.md#sudo)).
- **`@local` refuses it,** with `can't reboot @local, because it's the machine tsinfra runs on`.
- **It's a top-level step.** A fix that installs a kernel doesn't reboot by itself, and the script follows that step
  with `h.reboot`.
- **It returns a `ChangeStepResult<"reboot">`,** so a run can follow it. Like a run's, it can't be needed, because nothing
  about the host's state says a reboot happened.

## Failure

Scripts never check results for errors. When a call on `h` fails, the host is marked failed and the call throws, which
stops the script at that point. The CLI reports the host as failed, with the call that failed and its output.

Catching the error does not recover the host. It stays failed, and every later call on `h` throws the same error
straight away without touching the host. Code between the catch and the next call on `h` still runs, so do not catch
around calls on `h`. The same holds inside a check, fix, or run function. A step or run whose function catches a failed
`read` or `exec` still fails. A command whose non-zero exit is a legitimate answer goes through `inspect`.

So a fallback that depends on a command checks an `inspect` result instead of catching:

```ts
// The second `read` throws the first one's error without running, because the host has already failed.
try {
  await h.read("curl -f https://example.com/a")
} catch {
  await h.read("curl -f https://example.com/b")
}

// The first command's non-zero exit is only an answer, so the host hasn't failed.
const { exitCode } = await h.inspect("curl -f https://example.com/a")
if (exitCode !== 0) await h.read("curl -f https://example.com/b")
```

Catching anything that doesn't come from `h` or a tool works as usual, like a `fetch` in the script that falls back to
another URL. tsinfra never sees that error.

If the host function throws for any other reason (a bug in the script), the CLI catches it and reports the host as
failed in the same way.

## What `plan` can and cannot show

`plan` reads every step's state from the machine as it is now. A step after a step that would change reads the old
state, not the state that step would leave behind. For most steps that does not matter. Where it does, a
[need](./needs.md) is how you say so, and `plan` then shows the step as waiting instead of a misleading answer.

When any step's state differed, `plan` adds a reminder before the summary: "Steps after a change were checked without
that change, so apply may differ." Terraform's "known after apply" is the same problem. Terraform knows which values
depend on which resources, so it can mark exactly those. tsinfra does not know which steps depend on each other, so it
warns in general, unless a step's `needs` says so.
