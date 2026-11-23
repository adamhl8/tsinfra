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
- [`dir`](#dir)
- [`ensure`](#ensure)
  - [What a check may change](#what-a-check-may-change)
  - [`fix`](#fix)
- [`run`](#run)
  - [When an apply doesn't finish](#when-an-apply-doesnt-finish)
- [Messages](#messages)
- [Failure](#failure)
- [What `plan` can and cannot show](#what-plan-can-and-cannot-show)

<!-- tocstop -->

```ts
// `O` is the type of the host's options, which `host()` passes on to its function's `h`.
interface Host<O extends HostOptions = HostOptions> {
  readonly meta: HostMeta<O>
  readonly log: Log
  read(cmd: string, options?: ReadOptions): Promise<string>
  inspect(cmd: string, options?: InspectOptions): Promise<InspectResult>
  file(path: string, content: string | Uint8Array | Blob, options?: FileOptions): Promise<ChangeStepResult>
  link(path: string, target: string, options?: LinkOptions): Promise<ChangeStepResult>
  ensure<T extends WantOf<T>>(name: string, options: EnsureOptions<T>): Promise<ChangeStepResult>
  run(
    name: string,
    cmd: string | ((tools: ChangeTools) => Promise<void>),
    options: RunOptions,
  ): Promise<ChangeStepResult>
}

// What the script is given about the host besides its steps, known before it runs. It's frozen.
// Each field's type is derived from the host's options.
interface HostMeta<O extends HostOptions = HostOptions> {
  readonly name: string // the host script's name, e.g. "sonarr"
  // `string` with sudo: { password }, `string | undefined` with sudo: true, `undefined` with sudo off.
  // See Transport's sudo section.
  readonly sudoPassword: SudoPassword<O["sudo"]>
}

// Records a message for the report. It runs nothing on the host, so it's synchronous. See Messages.
interface Log {
  info(message: string): void // shown from -v
  warn(message: string): void // shown at the default level, and counted in the summary
}

// Tools that only read the host, given to a check function. These are the same as `h.read` and `h.inspect`.
type ReadTools = { read: Exec; inspect: Inspect }

// Tools that can change the host, given to a fix or run function.
type ChangeTools = { exec: Exec; inspect: Inspect }

// Runs one command and returns its stdout. A check gets it as `read`, and a fix or run function as `exec`.
type Exec = (cmd: string, options?: MaskOptions) => Promise<string>

// Runs one command and returns its output and exit code, without failing on a non-zero exit.
type Inspect = (cmd: string, options?: MaskOptions) => Promise<InspectResult>

type MaskOptions = {
  maskOutput?: boolean // mask the output like a secret, here and in every later command on the host
}

// Variables every command in the step references as "$NAME", including its functions' tool calls.
type EnvOptions = {
  env?: Record<string, string>
  secretEnv?: Record<string, string> // shown as [MASKED] wherever they'd show, from then on
}

type ReadOptions = EnvOptions & MaskOptions
type InspectOptions = EnvOptions & MaskOptions

type InspectResult = {
  stdout: string // trimmed
  stderr: string // trimmed
  exitCode: number
}

type ChangeStepKind = "file" | "link" | "dir" | "ensure" | "run"

// What a change step returns.
type ChangeStepResult<K extends ChangeStepKind = ChangeStepKind> = {
  name: string // shown when another step needs this one
  kind: K // the method on `h` that ran it, like "ensure" or "run", so `needs` can refuse a run's result
  changed: boolean // the step changed something, would change it in plan, or waits on a step it needs
}
```

`changed` is what lets a script react to a step, as in `h.run(..., { after: [unit] })`. In plan mode it means "would change", so the follow-up shows up in the plan as a `>` line exactly when it would run for real.

Scripts only see `changed`. They cannot tell a real change from a would-be one, so they cannot branch on the mode and make the plan differ from what `apply` does. The output shows each step's full status: unchanged, changed, would change, waiting, or failed.

## Choosing a method

An `ensure` is the if statement you would write without `plan`, like `if (!(await isInstalled())) await install()`. The difference is that tsinfra gets the condition and the body separately. That lets it run only the condition in `plan`, run the condition again after the body in `apply`, and count a condition that did not pass as drift.

So plain TypeScript control flow is fine in a host script, except for one decision: whether a change is needed. That decision belongs in how a step reads the host's state, where tsinfra can see it.

| When the code...                       | Use                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| changes state that can be checked      | [`ensure`](#ensure), or [`file`](#file), [`link`](#link), or [`dir`](#dir) for a file, a symlink, or a directory |
| follows up on a change, or always runs | [`run`](#run) with `after`                                                                                       |
| picks which steps apply                | [`read`](#read) or [`inspect`](#inspect), plus an `if`                                                           |

A fact that picks steps is one that no step on the host changes, like the CPU architecture or whether the host is a container. Branching on state that an earlier step changes runs into [what `plan` cannot show](#what-plan-can-and-cannot-show).

Read a fact at the top level, and use it inside a step through the closure. A fact doesn't change during the run, so reading it once is enough, even when it only shapes one step, like the CPU architecture in a download URL. A step's function can't call a step on `h`, so a one-off command that only a fix needs goes through the fix's own tools instead, and is recorded under that step.

The wrong shape for a change is a read, an `if`, and a `run`:

```ts
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) await h.run("Install docker", installDocker, { after: "always" })
```

It mostly works. `plan` runs the inspect and shows the run when docker is missing. What it loses is the check after the fix, the drift exit code, and the step's status line in verbose output when docker is already there. Nothing looks broken, which is why the table matters. The same step as an `ensure`:

```ts
await h.ensure("Install docker", { want: true, check: "command -v docker", fix: installDocker })
```

## Commands

Everything that runs on the host takes one command at a time, so you never have to write a multi-line shell script. Shell is for basic commands like `systemctl` or `docker compose`. Work out values in TypeScript, not with pipes and `cut`.

Two shapes follow from that:

- **Computing a value** (a step's `check`) takes a command, or a function given `read` and `inspect` that returns the value. The function calls them as many times as it needs. It also runs during `plan`, so it must not change what the script manages.
- **Changing the host** (a step's `fix`, and `run`) takes a command, or a function given `exec` and `inspect`. The function calls `exec` once per command that changes the host. It only runs in `apply`.

**Let commands print.** Don't add `-q`, `--quiet`, or `>/dev/null` just because nothing reads a command's output. tsinfra records every command's output under its step, and the report shows none of it by default, so quieting a command only hides it from `-vvv` and from a failure's error, which is when you'd want it. Keep a quiet flag only where it changes the output a script uses, like `docker compose ps -q` printing only container IDs.

`read`, `inspect`, and `exec` are the tools. Each runs one command and takes `ToolOptions`: `input` and `maskOutput`. `read` and `exec` return stdout and fail on a non-zero exit. `inspect` never fails on a non-zero exit, for a command whose exit code or stderr is the answer.

**Values go into a command as environment variables,** not into its text. A step takes `env` and `secretEnv`, and its commands reference them the way shell scripts do, as `"$NAME"`:

```ts
await h.read('curl -fsSL -H "Authorization: Bearer $TOKEN" "$URL"', {
  secretEnv: { TOKEN: token },
  env: { URL: url },
})
```

tsinfra sets the variables just before the command runs, so the shell expands them wherever they appear, inside double quotes or not. tsinfra never quotes a value into a command, so any value works exactly as it is, with spaces, `$`, or `"` in it. Write `"$NAME"` in double quotes, as in any shell script, because a bare `$NAME` splits on spaces. This is GitHub's advice for secrets in Actions too, because putting values into a script's text invites injection and quoting bugs.

The variables are exported, so a tool that reads its credentials from the environment gets them without the command naming them at all:

```ts
await h.read("gh api user", { secretEnv: { GH_TOKEN: token } })
```

A `sudo` in the command still gets a variable the command names, like `sudo tee "$FILE"`, because the shell expands it before `sudo` runs. A program run under `sudo` doesn't see the exported variables themselves, because sudo resets the environment, so `sudo gh api user` gets no `GH_TOKEN`.

A name must be a valid shell name, made of letters, digits, and underscores, and not starting with a digit. Any valid name works, `PATH` and `HOME` included, but a name can't be in both `env` and `secretEnv`. A value must be a string, and tsinfra doesn't convert one, so a port goes in as `String(port)`. Values are literal, so a value can't expand another variable. `env: { PATH: "/opt/go/bin:$PATH" }` sets `PATH` to that exact text. Extend `PATH` in the command instead, where the shell expands it:

```ts
await h.read('PATH="/opt/go/bin:$PATH" go version')
```

`env` and `secretEnv` on a step reach every command it runs: a string `check` or `fix`, a run's command, and every tool call inside a check, fix, or run function. The tools take them too, for a value that only exists inside a function, like a container ID from one `exec`, or a secret a fix fetches itself, so `plan` never fetches it:

```ts
fix: async ({ exec }) => {
  const token = await $`op read op://vault/runner/token`.text()
  await exec('./config.sh --token "$TOKEN"', { secretEnv: { TOKEN: token } })
}
```

A call's variables are added to the step's for that one command, so a name the step also sets takes the call's value, only for that call. A name can't be in both of one call's `env` and `secretEnv`, the same as a step's. A call's `secretEnv` joins the host's secrets, so it's masked from that call on.

**A value that could hold shell syntax goes in through `env`, not into the command string.** A command string is code, and tsinfra runs it as written, so a value put into it is read as code too. A space or a newline in it breaks the command, and a `;` or `$(...)` runs part of it. Through `env`, the shell only ever reads it as a value. What decides it is the value's shape, not where it came from. A value with a known, safe shape, like a package name, a version, or a path you wrote, can go into the string, even when it came from a host's output, like the names a list check found. A value whose shape you don't control goes through `env`: file names from `ls`, a message, a file's contents, user input, or anything fetched that could hold more than you expect. A secret always goes through `secretEnv`, whatever its shape, so it's masked.

**`secretEnv` keeps a secret out of everything tsinfra shows or keeps.** The command's text never holds it. Its value shows as `[MASKED]` in the record's variables, and in the output and errors of the commands it reaches and of every later command on the host. Masking replaces every match of the value, and of each line of a multi-line value, because a diff or an error can show one line of it. So a very short secret masks a lot. That's noisy, but never leaks. tsinfra masks each value as it records it, so the record never holds a secret. Your script still gets the real values. A value that differs only in secrets still shows, as `[MASKED] -> [MASKED]`, because a step works out what differs before its values are masked.

**`maskOutput: true` masks a command's output,** for a secret read from the host, like `cat /etc/app/token`. It's an option on the tools and on `h.read` and `h.inspect`. The output joins the host's secrets, so later commands mask it too, including in a command's text, if a function puts it there.

**`input` sends data to a command's stdin,** for data from the control machine, like a rendered config or a list of packages. It's an option on the tools and on `h.read` and `h.inspect`. It takes the same content as `file`: a string, bytes, or a `Blob` like `Bun.file(...)`, up to the same 10 MB (see [`file`](#file)). A check needs it as much as a fix, like `inspect("diff - /etc/app.conf", { input: rendered })`:

```ts
await h.ensure("Install brew packages", {
  want: brewEntries,
  check: async ({ read }) => parseEntries(await read("brew bundle dump --file=-")),
  fix: async ({ exec }, { missing, extra }) => {
    if (missing.length > 0) await exec("brew bundle install --file=-", { input: brewfile })
    if (extra.length > 0) await exec("brew bundle cleanup --force --file=-", { input: brewfile })
  },
})
```

`h.run` and an `ensure`'s command strings don't take it, because a command string has no options of its own. An `ensure`'s `check` and `fix` share one options object, so one `input` couldn't say which command it's for. A check or fix function reaches `input` through its tools. A `sudo` in the command passes the input on to the program it runs (see [Transport](./transport.md#input)).

The record never holds the input, because it can be a secret, and it can be large. A read or inspect shows it in its options as `<content>` (see [CLI](./cli.md#output)). A tool call shows its options under its command, with `input` as `<content>`.

The input itself is never recorded, but it isn't masked either, so a command that prints it, in its output or in an error, shows it in the record. A secret belongs in `secretEnv`, on the tool call for one a fix fetches itself.

The command reads a pipe, not a file. Many commands take `-` or `/dev/stdin` in place of a path. One that only takes a path, or that seeks in its input, gets the data written to a temp file first:

```ts
const tmp = await exec("mktemp")
await exec(`cat > '${tmp}'`, { input: dump })
await exec(`restore-tool --file '${tmp}'`)
```

Data that's useful as a file on its own still belongs in a `file` step, like a `~/.Brewfile` you also run `brew bundle --global` against by hand.

Every output a script gets back is trimmed of leading and trailing whitespace, because that is what a script usually compares to. That covers `read`, `exec`, and both streams from `inspect`, on `h` and as tools. tsinfra's own comparison for a string `want` strips only trailing newlines, so stray spaces in the real value still count as drift.

`read` and `exec` behave the same, and the name says which mode the function runs in. A check function also runs in `plan`, so it gets `read` and `inspect`, the same pair `h` has. A fix or run function only runs in `apply`, so it gets `exec` and `inspect`. Each function gets one tool that fails on a non-zero exit and one that does not. A function gets its tools in an object, as in `async ({ read }) =>` or `async ({ exec }) =>`, so tools can be added later without changing existing scripts. `exec` is not `h.run`. A run is a step with its own name in the output, and a command inside a fix is part of one change that the step's name already covers.

**An option takes a function when tsinfra decides when, or whether, it runs.** `check` runs in both modes and again after the fix. `fix` and a run's command run only in `apply`, and only when needed. Every other option is a plain value that your script computes before the call: `want`, `needs`, `after`, and `file`'s `content`. A `want` read with `h.read` sees the host before any earlier change in `plan`, so when an earlier step changes what it reads, the read belongs in the check (see [Recipes](./recipes.md#the-state-you-want-or-whats-left-to-do)). `h.read` and `h.inspect` run straight away, so they take a command, not a function. Combining several reads is ordinary code at the top level.

**A function holds commands, not decisions.** A fix or run function that tests the machine before acting is an `ensure` step in disguise (see [`run`](#run)).

**`h` is for the top level.** Inside a check, fix, or run function, use only the tools the function is given. Every method on `h` fails the host while another step is running, with an error like `'read' can't run while ensure step 'A' is running`. A read's name is its command, as in `read step 'uname -m'`. That rules out these mistakes:

- **A step inside a step.** A step inside a fix never shows in `plan`, because `plan` never runs the fix. A step inside a check runs its fix while checking.
- **`h.read` or `h.inspect` inside a step's function.** The function's own tools do the same job, so there is one way to run a command inside a step.
- **Steps side by side.** Steps on one host run one at a time, so `Promise.all` over steps fails as soon as the second one starts. That includes reads. Commands inside one step can still run at once, with `Promise.all` over `exec` in a fix.

A check function runs in `plan`, so a mistake there shows up on the first `plan`. A fix or run function only runs in `apply`, so a mistake there shows up in `apply`.

## Steps

A step is one call on `h`, other than `h.log` (see [Messages](#messages)). A host function is a series of steps, run one at a time at the top level of the script. There are two kinds:

- **Read steps** tell the script about the host, and return what they found. They're [`read`](#read) and [`inspect`](#inspect).
- **Change steps** can change the host, whether or not they do, and each returns a `ChangeStepResult`. They're all the others.

Most change steps read one piece of the host's state, and in `apply` run a fix when it differs. `ensure` is the step where you write how to read it, as its `check`. [`file`](#file), [`link`](#link), and [`dir`](#dir) are steps that read the state themselves. [`run`](#run) is a step that reads no state.

The steps on `h` are primitives: none of them needs to know a tool beyond `sh` and the POSIX commands. An integration is what does, like installing packages with a package manager: functions that take `h` and call these steps to set up one specific program, service, or piece of config. The integrations tsinfra ships will be imports, not methods on `h` (see [the roadmap](./roadmap.md#integrations-worth-shipping)).

Name a step like a function, starting with a verb ("Install Caddy"), or as the state it ensures ("Caddy is installed"). Both read well after `ensure`.

A change step's name must be unique in its host script. `file`, `link`, and `dir` are named by their path, so two of them on one path clash too. The second step fails the host, under its own name, with `an earlier ensure step has the same name, and step names must be unique in a host script`. `plan` fails the same way. Two path steps also clash when their paths are spelled differently but [resolve](#file) to the same one, like `~/x` and `/home/alice/x`, with `an earlier file step has the same path, and a path can have only one file, link, or dir step in a host script`. The step keeps its name as written in the report. The report, `needs`, and [open changes](#when-an-apply-doesnt-finish) tell steps apart by name. Reads and inspects are named by their command, so reading the same thing twice is fine. Two steps that set one attribute of a path differently fail too, which also covers a link's target (see [`file`](#file)).

A step in a loop puts the item in its name, like `` `Install ${name}` ``. A helper that adds steps can be called twice on one host only when its step names differ, like by including its arguments.

## `read`

Runs a command on the host in both modes and returns its output, trimmed. Each `h.read` is a step of its own. It has no name, so errors and verbose output show its command. It is for observations a script branches on:

```ts
const arch = await h.read("uname -m")
const firewall = await h.read("sudo ufw status")
```

A non-zero exit fails the host, with the command's stderr. When the exit code or stderr is the answer, use [`inspect`](#inspect). A `read` must not change what the script manages, because it also runs during `plan` (see [what a check may change](#what-a-check-may-change)). Nothing can enforce that.

A read that needs a secret takes it through `secretEnv`, a read whose output is a secret takes `maskOutput: true`, and a read whose command needs data on its stdin takes `input` (see [Commands](#commands)). The script always gets the real output.

## `inspect`

Runs a command on the host in both modes and returns its stdout, stderr, and exit code. It never fails on a non-zero exit, so it suits a command whose exit code is the answer, and one that prints the answer on stderr, like `java -version`. Like `read`, it is a step of its own with no name, and it must not change what the script manages.

```ts
const container = await h.inspect("systemd-detect-virt --container")
if (container.exitCode !== 0) await tuneKernel(h)
```

It takes the same options as `read`: `env`, `secretEnv`, `input`, and `maskOutput`, which masks its stdout.

Check, fix, and run functions get an `inspect` tool too. A command that could not run at all, like one on an unreachable host, still fails the host.

`read` stays the default and keeps returning a string, because most reads only want stdout, and a failed `read` means something is broken. An option on `read` that changed its return type would need overloads.

## `file`

```ts
type FileOptions = {
  mode?: FileMode // "644", "rw-r--r--", or a constant like PUBLIC_FILE_MODE. Managed only when given
  user?: string | number // a name is compared with the user's name, a number with its uid
  group?: string | number // a name is compared with the group's name, a number with its gid
  sudo?: boolean // run the file details script, the diff, and the write as root
  secret?: boolean // never fetch or show the old content
  overwrite?: boolean // default true. false writes the content only when the file is missing
  validate?: (tempPath: string) => string // a command that checks the new content before it replaces the file
  needs?: ChangeStepResult<"file" | "link" | "dir" | "ensure">[]
}
```

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
await h.file("/etc/caddy/Caddyfile", Bun.file(path.join(FILES, "Caddyfile")), { sudo: true })
await h.file("/etc/motd", "Welcome to sonarr\n")
```

Writes `content` to `path` on the host, and reports whether it changed. `content` is a string or bytes computed on the control machine, or a `Blob` like `Bun.file(...)` for a file there. Every option is optional, so the simplest call is a path and its content. The step is named by its path, and returns a `ChangeStepResult<"file">`, so a run can follow it and a later step can need it. A symlink is a step of its own, [`link`](#link).

**Content from a file on the control machine.** Pass `Bun.file(path)`, which is a `Blob`, not a string. A string is always the content itself, so it can't be mistaken for a path. tsinfra reads the `Blob` inside the step:

- **A missing file fails the step,** like `failed to read local file '/repo/files/Caddyfile'`, not the script.
- **Its size is known before reading,** from `blob.size`, so the [size limit](#the-write) fails before anything is read.
- **It leaves room for streaming.** `blob.stream()` is how large files could be sent without holding them in memory (see [the roadmap](./roadmap.md#files-over-10-mb)).

A file that needs values filled in is read and edited in the script, then passed as a string, like any template.

`Bun.file("files/x")` resolves a relative path against the directory tsinfra runs from. Build paths from the script's own location instead, so they work from anywhere. One file in the repo can hold them:

```ts
// lib/paths.ts
import path from "node:path"

export const ROOT = path.resolve(import.meta.dir, "..")
export const FILES = path.join(ROOT, "files")
```

tsinfra doesn't provide these, because only the repo knows its own layout, and `import.meta.dir` already resolves from the file itself.

**Modes.** `mode` takes octal, like `"644"` or `"4755"`, or the symbolic form `ls -l` prints, like `"rw-r--r--"`, with `s`/`S` and `t`/`T` for setuid, setgid, and the sticky bit. Both are template literal types, so a typo like `"648"` or `"rw-r--r-"` fails to type-check. chmod's `u=rw,g=r` form isn't supported, because its `+` and `-` are relative to the current mode, and a step states the mode it wants. A changed mode shows both notations, whichever one the script wrote, like `rw------- (600) -> rw-r--r-- (644)`. tsinfra exports named modes, each a symbolic string, so hovering one shows its permissions:

| Constant                  | Mode        | Octal | For                                        |
| ------------------------- | ----------- | ----- | ------------------------------------------ |
| `PUBLIC_FILE_MODE`        | `rw-r--r--` | `644` | Most config files                          |
| `GROUP_FILE_MODE`         | `rw-r-----` | `640` | A secret a service reads through its group |
| `PRIVATE_FILE_MODE`       | `rw-------` | `600` | Keys, tokens, and other secrets            |
| `PUBLIC_EXECUTABLE_MODE`  | `rwxr-xr-x` | `755` | Scripts and binaries                       |
| `GROUP_EXECUTABLE_MODE`   | `rwxr-x---` | `750` | A script only a group may run              |
| `PRIVATE_EXECUTABLE_MODE` | `rwx------` | `700` | A script only its owner may run            |
| `PUBLIC_DIRECTORY_MODE`   | `rwxr-xr-x` | `755` | Most directories                           |
| `GROUP_DIRECTORY_MODE`    | `rwxr-x---` | `750` | A directory only a group may enter         |
| `PRIVATE_DIRECTORY_MODE`  | `rwx------` | `700` | A directory only its owner may enter       |

**Defaults.** `mode`, `user`, and `group` are managed only when given. An existing file keeps its own otherwise, the way Ansible, Salt, Chef, and Puppet all do, so a `file` step never loosens a `0600` file or takes ownership away from an app. A new file gets mode `644`, or `600` with `secret`, and is owned by whichever user ran the write: the SSH user, or root under `sudo`.

**Two steps can't set one attribute differently.** Each apply would undo the other, and the plan would never come out clean. So a step that sets a `mode`, `user`, or `group` an earlier step set differently on the same path fails, in `plan` too, naming the earlier step, like `'/home/alice/dotfiles/ssh/config' already gets mode '600' from link '~/.ssh/config', so it can't get '644'`. This covers `file`, [`dir`](#dir), and a link's [`targetAttributes`](#link), so a `file` and a link to it can't fight over its mode. Paths compare after `~/` is resolved. Each attribute compares on its own, so one step can set a path's mode and another its user, and an attribute left out never conflicts. Modes compare by value, so `"600"` and `PRIVATE_FILE_MODE` agree. A user or group compares as written, so `"alice"` and `1000` conflict even when they're the same user, because telling would take a read from the host.

**Paths.** A path must be absolute, starting with `/` or `~/`. A relative path fails, like `must be an absolute path, starting with / or ~/ (was "app.conf")`, because it would land wherever the shell starts. A leading `~/` means the connecting user's home on the host, even under `sudo`. A path goes into every command fully single-quoted, with each `'` written as `'\''`, so a space or a quote can't break the command. Quoting also stops the shell from expanding `~`, which only happens when `~` is unquoted at the start of a word. So tsinfra resolves `~/` itself:

- **It reads the home directory when the host is prepared,** before the script runs, as the SSH user, with `printf '%s' "$HOME"`. That's one command per host, and it doubles as the first contact with the host, so a host that can't run commands fails before its script starts. It runs without `sudo`, because under `sudo` the shell's `$HOME` is usually root's. `printf '%s'` prints the value exactly, and avoids the way some shells treat backslashes or `-n` in `echo`.
- **It replaces the leading `~/` with that path,** then quotes the whole path. Every command `file` builds uses a plain absolute path, the same with or without `sudo`. A bare `~` means the home directory itself. [`link`](#link) gets the same treatment, for its path and its target.
- **An empty or relative `HOME` fails the host when it's prepared,** like `$HOME isn't set on the host`, whether or not the script uses `~`. `printf` prints nothing whether `HOME` is unset or empty, so one check covers both. Over SSH, sshd sets `HOME` from the user's account, so this only happens when tsinfra itself runs without one. A `HOME` of `/` is odd but valid, so it's allowed.
- **Empty and `.` segments and a trailing `/` are dropped,** so `/etc//app/./app.conf/` writes `/etc/app/app.conf`.
- **A `..` segment is an error,** like `must be a path without a '..' segment (was "/etc/../app.conf")`. The host resolves `..` through symlinks, so `/a/link/../b` isn't `/a/b` when `link` points elsewhere, and tsinfra can't resolve it as text.
- **`~otheruser/` is an error,** because it isn't an absolute path. Resolving another user's home would need an account lookup that nothing needs yet.

The shell's own `~` is just `$HOME` too. POSIX leaves the result unspecified when `HOME` is unset, and shells differ: bash, zsh, and macOS `/bin/sh` fall back to the account database, while dash and busybox sh leave `~` in place, which would quietly make a directory named `~`. Reading `$HOME` ourselves turns that into an error. pyinfra leaves a leading `~/` unquoted so the shell expands it, and runs `sudo -H`, so under sudo its `~` means root's home. That suits pyinfra, which can sudo to any user. tsinfra only escalates to root, where `~` as `/root` is rarely what a script means.

**Symlinks and other non-files are refused.** If `path` is a symlink, a directory, or anything but a regular file, the step fails, like `'/etc/x' is a symlink, so file won't replace it`. Managing a link is what [`link`](#link) is for. Whether `file` should follow a link and write to its target is open (see [the roadmap](./roadmap.md#following-symlinks-in-file)).

### Reading the state

One command prints what tsinfra needs, or a marker for a path that isn't a regular file:

```sh
if [ -L "$p" ]; then echo kind=link
elif [ ! -e "$p" ]; then echo kind=absent
elif [ ! -f "$p" ]; then echo kind=other
elif [ ! -r "$p" ]; then echo kind=unreadable
else
  echo kind=file
  { command -v sha256sum >/dev/null 2>&1 && sha256sum < "$p"; } ||
  { command -v shasum >/dev/null 2>&1 && shasum -a 256 < "$p"; } ||
  { command -v sha256 >/dev/null 2>&1 && sha256 < "$p"; } ||
  { echo 'failed to get the sha256 hash of the file on the host' >&2; exit 1; }
  stat -c '%a %u %g %U %G %s' "$p" 2>/dev/null || stat -f '%Mp%Lp %u %g %Su %Sg %z' "$p"
fi
```

- **The hash is sha256,** the default in Salt, Chef, and Puppet. POSIX has no sha256 command, so the file details script tries each common one: `sha256sum` (GNU coreutils, busybox, current macOS), `shasum -a 256` (older macOS), and `sha256` (FreeBSD, OpenBSD). This is the same chain pyinfra uses. It checks that each one exists first, so a missing one writes nothing to stderr. One that exists and fails keeps its stderr, and the next one still runs. The file goes in on stdin, because GNU `sha256sum` escapes odd filenames in its output and prefixes the line with `\`. tsinfra reads the first 64 hex characters, because GNU, busybox, and `shasum` print `<hash>  -` and BSD `sha256` prints the bare hash. When no command gives a hash, the script exits 1, because `stat` would otherwise exit 0 and hide the failure. Every answer the script gives exits 0, so a non-zero exit always means it broke, and the error holds its stderr: the stderr of any command that exists and failed, then `failed to get the sha256 hash of the file on the host`.
- **`stat -c` goes first,** because GNU's `stat -f fmt file` doesn't fail. It prints filesystem information instead. BSD needs `%Mp%Lp`, because `%Lp` alone drops setuid and setgid.
- **The local hash** comes from Bun's `CryptoHasher("sha256")`. No file is transferred just to learn it is unchanged.
- **The file is in sync** when the hash matches, and so does each attribute that was given. Modes are compared as octal numbers, because GNU prints `644` and BSD prints `0644`. A user or group given as a name is compared with the name `stat` prints, and one given as a number with the uid or gid. There's no portable command to turn a group name into its id, because `getent` is Linux-only and macOS uses `dscl`, so names stay names. GNU and busybox print `UNKNOWN` for an id with no name, which only matters for an id, and those are compared as numbers.
- **Verification** reads the state again after the write, through `converge`. A file still out of sync fails with "the host's state still differs after the fix", with the details under it.

### The diff

When the hashes differ, a second command fetches the old content with `cat`, so the report can show a diff under the step (see [CLI](./cli.md#how-the-report-is-built)). It skips that fetch, and shows a `content:` line instead, in these cases:

| Case                                                | Line                                           |
| --------------------------------------------------- | ---------------------------------------------- |
| The file doesn't exist yet                          | `content: new file, 2.05 kB`                   |
| `secret: true`                                      | `content: hidden, 1.2 kB -> 1.3 kB`            |
| Either side is binary: a NUL byte, or invalid UTF-8 | `content: binary, 12 kB -> 14 kB`              |
| Either side is over 100 kB                          | `content: too large to diff, 300 kB -> 310 kB` |

Sizes use SI units, 1 kB = 1000 bytes, the way npm and most file managers show them. A size under 1 kB is spelled out, like `15 bytes`, because a lone `B` reads like "billion". The words are italic, and the sizes are colored like `got` and `want`, old in red and new in green. Every `content:` line ends with the sizes, old to new, or just the new size for a new file. The sizes come from `stat`, so a `secret` file shows them without its content being fetched.

With `secret`, tsinfra never runs `cat` and never prints a full hash. The 100 kB limit follows Ansible, which caps its diff at about 100 kB. A changed attribute shows on a line of its own, old value to new, lined up with any `content:` line:

```
  ~ change: (file) /etc/app/app.conf
      ──────────────
      3  port = 8080
        -workers = 4
      4 +workers = 8
      5  log = info
      ──────────────
      mode: rw-r--r-- (644) -> rw------- (600)
      user: root -> sonarr
```

### The write

The write is one script, run on the host. Content travels inside it, base64-encoded in a heredoc, and lands in a temp file next to the destination, which one rename puts in place. See [Transport](./transport.md#file-writes) for the script and why each step comes in its order. The destination is only ever the old file or the complete new one, already with its owner and mode.

**Size limit.** Content over 10 MB fails before anything is read or sent, like `local file '/srv/app.iso' is 14 MB, above the 10 MB limit`. The shell holds the whole script in memory, and base64 adds a third, so the heredoc suits config files, not large binaries. A streaming path for large files is open (see [the roadmap](./roadmap.md#files-over-10-mb)).

**Content written only once.** `overwrite: false` creates a missing file, and never touches it after that. It's for a file an app rewrites itself, like Sonarr's `config.xml`, which changes whenever a setting changes in its web UI. Managed normally, every `plan` would show that as drift, and every `apply` would undo the UI's changes:

```ts
await h.file("/var/lib/sonarr/config.xml", sonarrConfig, { user: "sonarr", mode: "600", overwrite: false })
```

- **An existing file is left alone,** so it shows no diff and never counts as drift. Its content is never compared.
- **A missing file** shows as `content: new file` in `plan`, and gets written in `apply`, as usual. `mode`, `user`, `group`, and `validate` apply to that write.
- **`mode`, `user`, and `group` aren't managed after that,** like Chef's `:create_if_missing`. An app that rewrites its file sets them too, often by renaming a new file over the old one. To keep one of them, add an `ensure`, like a check of `stat -c %a` that wants `600` and a fix that runs `chmod 600`.
- **The name** is fs-extra's `overwrite`, the usual JavaScript word for it. "Replace" already means swapping one kind of thing for another in `file`'s refusals.

**Validation.** `validate` runs a command against the temp file before the rename, so a broken config never replaces a working one. A bad `sshd_config` or sudoers file can lock tsinfra out of the host for good:

```ts
await h.file("/etc/ssh/sshd_config", sshdConfig, { sudo: true, validate: (tempPath) => `sshd -t -f ${tempPath}` })
await h.file("/etc/sudoers.d/alice", sudoers, {
  sudo: true,
  mode: "440",
  validate: (tempPath) => `visudo -cf ${tempPath}`,
})
```

- **It takes a function,** given the temp file's path already shell-quoted, so there's no placeholder like Ansible's `%s` to learn or forget. The function runs in `plan` too, so a command that comes back empty fails before anything is written.
- **It runs as the write does,** under `sudo` with `sudo: true`.
- **A non-zero exit fails the step.** The temp file is deleted and the old file stays as it was, like `failed to write '/etc/ssh/sshd_config' -> the validate command 'sshd -t -f "$tmppath"' exited with code 255: line 3: Bad configuration option: Foo`.
- **The temp file keeps the destination's name,** extension included, inside a temp directory like `.app.json.tsinfra.a1b2c3/app.json`, because some validators pick a parser by extension.
- **The command only runs in `apply`.** `plan` never writes the temp file, so invalid content shows up on the first `apply`.
- **It checks the file on its own.** A fragment that only makes sense with the rest of a config, like an nginx site, is checked by a `run` after the file instead, like `nginx -t && systemctl reload nginx`.

### `sudo` and permissions

`file` runs as one user from start to finish, with no upload-then-move hop:

| Option       | Runs as                   | For                                                            |
| ------------ | ------------------------- | -------------------------------------------------------------- |
| no `sudo`    | the SSH user, via `sh -s` | files the SSH user can write, like anything under `~`          |
| `sudo: true` | root, via `sudo`          | files under `/etc`, root-only files, or another user as `user` |

Under `sudo: true`, every part runs as root: the file details script, the `cat` for the diff, and the write. tsinfra writes all of those commands, so there is nowhere for a script to add `sudo` itself. This means `plan` also needs sudo on a host that manages such a file, and the host declares `sudo` on `host()` (see [Transport](./transport.md#sudo)).

`sudo` isn't the default, because a file written as root under `~` would end up owned by root, and because a host that never escalates shouldn't need sudo set up. A `file` step only escalates when it asks to.

Three mistakes get errors of their own instead of a raw shell error. For the first two, tsinfra runs `id` to see who runs the step's commands, which is root under `sudo`. They only fail when a write is coming, so a file already in sync passes, and they show in `plan` too:

- **`user` names another user without `sudo`,** like `user 'sonarr' needs sudo: true, because only root can change a file's owner to another user`. Only root can `chown` a file to someone else.
- **Someone else owns the file, and no `user` is given, without `sudo`,** like `'/etc/app.conf' is owned by 'sonarr', so writing it needs sudo: true`. A write keeps the file's owner with `chown`, which needs the same permission.
- **The file details script can't read the file without `sudo`,** like `can't read '/etc/shadow' as the SSH user, so it needs sudo: true`. That way an unreadable file doesn't look missing.

## `link`

```ts
type LinkOptions = {
  user?: string | number // the link's own owner. A name is compared with the user's name, a number with its uid
  group?: string | number // the link's own group. A name is compared with the group's name, a number with its gid
  force?: boolean // replace a regular file or an empty directory at the path
  targetAttributes?: { mode?: FileMode; user?: string | number; group?: string | number } // the target's, see below
  sudo?: boolean // read and make the link as root
  needs?: ChangeStepResult<"file" | "link" | "dir" | "ensure">[]
}
```

```ts
// The file at ~/.config/fish/config.fish links to the repo's copy.
const fishConfig = new URL("../dotfiles/fish/config.fish", import.meta.url).pathname
await h.link("~/.config/fish/config.fish", fishConfig)

// ssh refuses a config others can write, so the repo's copy gets 600.
const sshConfig = new URL("../dotfiles/ssh/config", import.meta.url).pathname
await h.link("~/.ssh/config", sshConfig, { targetAttributes: { mode: PRIVATE_FILE_MODE } })
```

Makes `path` a symlink to `target`, and reports whether it changed. This is how dotfiles in a repo can be linked into place on the control machine, so an edit in the repo shows up straight away. The step is named by its path, and its path follows the same rules as `file`'s (see [`file`](#file)).

`link` is a step of its own, not a form of `file`, because the two share only the path and the owner. A link has no content, mode of its own, or `secret`, and `force` means nothing for a regular file. Their details scripts, output, and writes differ too.

The words are easy to mix up. In `ln -s TARGET LINK`, the target is the original file the link points to, and the link is the new path. `h.link` takes them the other way around, `path` then `target`, because every step names the path it manages first.

- **The target is a path on the same host as the link.** A symlink stores a path, and the system looks it up wherever the link lives. For `@local`, that is the control machine, so a link into the repo works. On a remote host, a link points at that host's own files, like `/etc/nginx/sites-enabled/app` to `/etc/nginx/sites-available/app`.
- **The target must be absolute,** starting with `/` or `~/`. A relative target is resolved from the link's own directory, every time the link is followed, not from where the script runs. That is the classic mistake: a link to `dotfiles/config.fish` made from the repo looks for `~/.config/fish/dotfiles/config.fish`. A relative target fails with `target must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory`. `~/` means the SSH user's home, as it does for `path`. All six tools compared in [Transport](./transport.md#file-writes) allow a relative target. Refusing one now can be loosened later without breaking a script, and the reverse can't.
- **The target may not exist yet,** because a later step might create it, or a mounted drive might not be there. The link is still made, with a `warning: nothing exists at target -> <target>` line under it, so a typo in the repo path stands out. The warning shows even when the link is already right, without `--verbose`, and the summary counts it. It's not drift, so it doesn't change the exit code.
- **The link details script** reads the existing link's target with `readlink` and compares it with `target` as an exact string, after `~/` is resolved. It also reads the mode and owner of the file at the end of `target`, with `stat -L`. It is in sync when `path` is a symlink that points there, with the right owner, and the target has the `targetAttributes` given.
- **An existing symlink is always updated** to point at `target`, because managing it is the point.
- **A regular file at `path` is an error** unless `force: true`, like `'/home/alice/.config/fish/config.fish' is a regular file, so link won't replace it without force: true`. This is the first run for dotfiles, where the real file still sits where the link will go. Move it into the repo, or set `force` to replace it. That is the same as `ln -f`, and there's no backup.
- **An empty directory at `path` is an error** unless `force: true`, like Ansible, because nothing can be lost.
- **A directory with anything in it is always an error,** even with `force`, because replacing it would throw away everything in it. A hidden file counts. Anything else that isn't a link or a regular file, like a socket, is always an error too.
- **`sudo` works as it does for `file`.** The link details script and the write both run as root, for the link and its target. So a link made as root is owned by root, unless the step sets the link's own `user` and `group`. That covers a link that shouldn't be root's, pointing at a target only root can change, with one `sudo`.
- **The output** shows `target: new link to /home/alice/dotfiles/fish/config.fish` for a new link, and a changed target as an attribute line, like `target: /home/alice/old -> /home/alice/new`. Paths are absolute, because that's what `readlink` gives back. Forcing something out shows `replaces a file` or `replaces an empty directory`. The target's attributes show after the link's own rows, prefixed with `target`, like `target user: root -> alice` and `target mode: rw-r--r-- (644) -> rw------- (600)`.
- **The write** makes the link in a temp directory next to `path`, then renames it into place, so there is almost never a moment with nothing at `path`. The exceptions are a forced empty directory, and replacing a link to a directory on busybox (see [Transport](./transport.md#link-writes)). The target's `chown` and `chmod` run after it. A link that's already right isn't remade, so a change to only the target leaves the link and its owner alone.
- **`user` and `group` are the link's own owner,** and work as they do for `file`: the value given, then what's at `path` now, then the default for something new. So do its errors for `user` naming another user, and for something someone else owns. `chown -h` changes the link, not what it points to. They never mean the target, so an option means the same file everywhere.
- **`targetAttributes` manages the file the link points to.** A link has no mode of its own: Linux ignores a symlink's mode, and `chmod` follows the link. So for dotfiles linked into a repo, the mode that matters is the repo file's. Its type is the exported `FileAttributes`: `mode`, `user`, and `group`, like `file`'s.
  - **Only the attributes given are managed,** like `file`. The target keeps its own value of any left out.
  - **It follows the target to the file at the end.** A target that's itself a link gets the attributes on what it points to, because `chmod` and `chown` without `-h` follow links, and the read uses `stat -L`, so both look at the same file.
  - **A missing target is skipped,** with the `nothing exists at target` warning. The step decides from what's on the host when it runs. In `plan`, a target an earlier step would create is still missing, so it's skipped. In `apply`, that step has run, so the attributes are set.
  - **A change to only the target is a change of the link step.** It reports `changed`, so a run with `after: [theLink]` runs, and a step that `needs` it waits in `plan`.
  - **The owner check runs for the target too,** so a target `user` that needs root fails in `plan`, and so does a `mode` on a target someone else owns, without `sudo`.
  - **Two steps that set one of the target's attributes differently fail,** whether they're two links or a link and a `file` or `dir` on its target (see [`file`](#file)).
- **It returns a `ChangeStepResult<"link">`,** so `needs` and `after` accept it the same as a file's. A run can follow a link that changed.

## `dir`

```ts
type DirOptions = {
  mode?: FileMode // octal like "750", or symbolic like "rwxr-x---", the same forms as file's
  user?: string | number // a name is compared with the user's name, a number with its uid
  group?: string | number // a name is compared with the group's name, a number with its gid
  sudo?: boolean // read and make the directory as root
  needs?: ChangeStepResult<"file" | "link" | "dir" | "ensure">[]
}
```

```ts
const data = await h.dir("/srv/sonarr", { mode: GROUP_DIRECTORY_MODE, user: "sonarr", group: "sonarr", sudo: true })
await h.file("/srv/sonarr/config.xml", sonarrConfig, { needs: [data], user: "sonarr", sudo: true })
```

Makes sure `path` is a directory, with the mode and owner the script gives, and reports whether it changed. The step is named by its path, and its path follows the same rules as `file`'s (see [`file`](#file)).

`dir` is a step of its own, built on the record `want` of [`ensure`](#ensure). It compares a record of what the script gave with `ensure`'s comparison, and the report shows a row per attribute that differs, like a file's attribute rows, with its mode in both notations. A directory has no content to send, hash, or diff, which is what `file` exists for.

- **What it compares** is `exists`, and only the attributes the script gave, like `{ exists: true, mode: "750", user: "sonarr", group: "sonarr" }`. A missing directory is `exists: false`, and every other key shows `(none)`.
- **`mode`** takes the same forms as `file`'s, and the directory constants in its table, and compares as octal. So `"750"`, `"rwxr-x---"`, and `GROUP_DIRECTORY_MODE` all match the same directory. It includes the setuid, setgid, and sticky bits, so `"750"` doesn't match a `2750` directory, and `"2750"` asks for setgid. It's recorded as its bits, and the report shows it like a file's, like `rwx------ (700) -> rwxr-x--- (750)`.
- **`user` and `group` work as they do for `file`.** A name is compared with the name, and a number with the id, which shows in italics. So do its errors for another user, and for a directory someone else owns.
- **An attribute left out isn't compared,** so an existing directory keeps its own. With none, `dir` only makes sure the directory exists.
- **Two steps can't set one attribute differently,** like `file`'s (see [`file`](#file)). A link whose `targetAttributes` set this directory's mode counts.
- **A symlink, a regular file, or anything else at the path is an error,** like `'/srv/sonarr' is a symlink, so dir won't replace it`. A link to a directory counts, because `dir` manages the directory itself.
- **Missing parents are made too,** with the default mode and owner. Only the directory itself gets `mode`, `user`, and `group`, so a tree that needs its own on each level takes a `dir` for each.
- **`sudo` works as it does for `file`.** The directory details script and the write both run as root.
- **The write** is `mkdir -p`, then `chown`, then `chmod` (see [Transport](./transport.md#directory-writes)).
- **The output** is `~ change: (dir) /srv/sonarr`, with a row per key that differs, like `mode: rwx------ (700) -> rwxr-x--- (750)`.
- **It returns a `ChangeStepResult<"dir">`,** so `needs` and `after` accept it. A file that goes in a new directory can need it, so `plan` waits instead of reading a path that doesn't exist yet.
- **It doesn't remove a directory.** Removing one is an `ensure` (see [Recipes](./recipes.md#removing-a-path-with-ensure)).

## `ensure`

```ts
// A record's values can be strings, numbers, booleans, `null`, lists of record values, sets of the first four, or
// nested records, to any depth.
type RecordPrimitive = string | number | boolean | null
type RecordValue = RecordPrimitive | readonly RecordValue[] | ReadonlySet<RecordPrimitive> | RecordWant
interface RecordWant {
  readonly [key: string]: RecordValue
}

// A `want` is a boolean, a string, a list or a set of strings, or a record. `WantOf<T>` checks a record by its own
// keys, each value a `RecordValue`, so a type an interface declares works too.
type WantOf<T> = boolean | string | readonly string[] | ReadonlySet<string> | { readonly [K in keyof T]: RecordValue }

// `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string.
type EnsureOptions<T extends WantOf<T>> = {
  // `true` means exit 0, or a function returning true, is already right. `false` means the opposite.
  // A string is compared to the command's stdout, or the function's value.
  // A list is compared to the command's lines, or the function's array, in order.
  // A set is compared to the command's lines, or the function's `Set`, as a set.
  // A record is compared to the function's object, by key, with a nested list in order, a nested set as a set,
  // and a nested record by key.
  want: T
  // A record `want` takes only a function, because a command's output has no keys.
  check: string | ((tools: ReadTools) => Promise<T>)
  // A function also gets `want` and what the check found: `{ want }` for a boolean, `{ got, want }` for a string or a
  // list, `{ want, missing, extra }` for a set, and `{ got, want, unmet, extra, nestedExtra }` for a record.
  // See `FixDifference`.
  fix: string | ((tools: ChangeTools, difference: FixDifference<T>) => Promise<void>)
  verify?: boolean // default true
  env?: Record<string, string> // see EnvOptions
  secretEnv?: Record<string, string>
  needs?: ChangeStepResult<"file" | "link" | "dir" | "ensure">[] // earlier steps this step's check depends on
}
```

`want` is the answer `check` gives when the state is already right, and `check` runs on the host. When they match, nothing happens. Otherwise the fix runs. `want` comes first, in the type and in every example, because it says what the step is after and decides how the check is read, so the check reads as "do we have it?". That matters most when a long check function would push `want` to the bottom. The report still shows `got:` before `want:`, because every comparison there reads from what's on the host to what the script wants, like `mode: 600 -> 644` and a diff's `-` then `+`. `want` is always written out, so the rule a check follows is visible at the call site. The field is `check`, not `read`, because `h.read` fails on a non-zero exit and a check never does.

**`want: true` or `false`** compares the exit status. `true` means exit 0 is already right, and `false` means a non-zero exit is. There is nothing to diff, so `plan` shows only the step's name. `true` suits state that only answers yes or no, like `brew bundle check`. `false` suits state that should be absent.

```ts
await h.ensure("Install Caddy", { want: true, check: "dpkg -s caddy", fix: "sudo apt-get install -y caddy" })
await h.ensure("Remove the old user", { want: false, check: "id olduser", fix: "sudo userdel olduser" })
```

**A string `want`** is compared to the command's stdout. `want` is computed in your script on the control machine. Trailing newlines are stripped from both (the way `$(cmd)` does), then the two are compared exactly. Stripping `want` too means a value built from a template literal that ends in a newline still matches. When they differ, the report shows how under the step's status line, in `plan` and `apply`, as a `got:` and a `want:` row. For a multi-line value, the rows hold only the lines that differ (see [CLI](./cli.md#how-the-report-is-built)). For several things, like packages, use a set `want`, or a list `want` when their order matters.

```ts
await h.ensure("Start Sonarr", {
  want: "active",
  check: "systemctl is-active sonarr",
  fix: "sudo systemctl enable --now sonarr",
})
```

**A set `want`**, a `Set` of strings, is compared as a set, so order and duplicates don't count, and neither side needs sorting. It suits a set of names, like packages that should be installed. A command check's stdout is split into lines, and its blank lines, empty or only whitespace, are left out. Every other line is an item as it is, so a trailing space counts. A check function returns a `Set`. Returning an array is a type error, and refused before it's compared for a script that gets past the types, because the check's type follows `want`'s, as it does for every `want`. An empty `new Set()` needs no type argument, and a readonly set works, like a constant.

```ts
await h.ensure("Install packages", {
  want: new Set(["fd", "jq", "ripgrep"]),
  check: "dpkg-query -W -f='${Package}\\n' fd jq ripgrep 2>/dev/null",
  fix: async ({ exec }, { missing }) => {
    await exec(`sudo apt-get install -y ${missing.join(" ")}`)
  },
})
```

The report shows a `missing:` row with what `want` has that the check didn't find, in `want`'s order, then an `extra:` row with what the check found that `want` doesn't have, in the check's order. A side with nothing has no row. They're named for how the host compares with `want`, not for what the fix does, because tsinfra doesn't know that.

```
  ~ change: (ensure) Install packages
      missing: ripgrep
```

**A list `want`**, an array of strings, is compared in order, so it matches only the same items in the same order, and a duplicate counts. It suits items whose order matters, like search domains or `PATH` entries. A command check's lines are read the same way as a set's, and a check function returns an array. A readonly array works, like a constant or `as const`.

```ts
await h.ensure("Set the search domains", {
  want: ["lan", "home.arpa"],
  check: async ({ read }) => (await read("resolvectl domain eth0")).split(" ").slice(1),
  fix: async ({ exec }) => {
    await exec("sudo resolvectl domain eth0 lan home.arpa")
  },
})

await h.ensure("Upgrade brew packages", { want: [], check: "brew outdated --quiet", fix: "brew upgrade" })
```

The report shows a diff from the host's list to the wanted one, framed like a file's: an item only the host has gets `-`, an item only `want` has gets `+`, and one unchanged item on each side of a change shows plain. A reorder reads as an item leaving one place and arriving in another, which `missing:` and `extra:` rows can't show, because they'd list the moved item under both without saying where it sits. Each item follows the value rules, so an empty one shows as `''` and one with a trailing space shows quoted (see [CLI](./cli.md#how-the-report-is-built)).

```
  ~ change: (ensure) Set the search domains
      ──────────
      -home.arpa
       lan
      +home.arpa
      ──────────
  ~ change: (ensure) Upgrade brew packages
      found: node
             python
```

`want: []` means nothing is left to do, for a check that lists what's left, like outdated packages. An empty list is the same in order or as a set. The report shows what the check found on a `found:` row, with no `-` lines, because what an item means depends on the check: an outdated package gets upgraded, not removed. `want: new Set()` shows the same way, and `want: {}` shows the record's keys and values under a `found:` heading.

**The type picks the comparison, not an option.** An array has an order and can hold an item twice, and a `Set` has neither, so the value's type already says which comparison the script means. An `ordered: true` option would say it again, and would leave an array meant as ordered compared as a set by default.

**A record `want`**, an object of string keys, compares values by key, like a package name to its version, or a config's settings. A value is a string, a number, a boolean, `null`, an array, a `Set`, or a nested record, to any depth, like a container's `env`, `labels`, or `ports`. Each compares the way its type does at the top level: a nested list in order, a nested set as a set, and a nested record by key, so key order doesn't count at any depth, and an array and a `Set` with the same items differ. A nested set holds only strings, numbers, booleans, and `null`, because a `Set` matches an object or an array only by identity, so one in a set would never match what the check returns. Each value is compared exactly, so a number never matches a string that reads the same: `8080` and `"8080"` differ, and the report shows the number in italics. `-0` matches `0`, as it does with `===`, at any depth, because the report shows both as `0`. `null` is a value, so `{ port: null }` and `{}` differ. A key only one side has is a difference at any depth. Only a check function can return a record, because a command's output has no keys, so `check: "..."` with a record `want` is a type error, and refused before it runs for a script that gets past the types. A record must be a plain object at every depth, so a `Map`, a class instance, or a `Promise` from a missing `await` is refused, because it would otherwise be compared by its own keys, which it usually has none of. A list or a record that holds itself is refused too, because showing it would never end. The error names the path to the value, like `want.env.PUID` or `want.ports[1]`. A fix function's `got`, `want`, and `unmet` follow `want`'s own type, so a `want` of strings gives it strings (see [What the check found](#fix)). A record's type can come from an `interface`, not only a type alias or a literal. TypeScript never lets an interface stand in for an index signature like `RecordWant`'s, so the types check a record by its own keys instead, and the exported `WantOf<T>` is that check: a helper that passes a step's options on takes `<T extends WantOf<T>>(options: EnsureOptions<T>)`.

```ts
const wanted: Record<string, string> = {}
for (const [name, spec] of Object.entries(specs)) {
  wanted[name] = await h.read('bun pm view "$SPEC" version', { env: { SPEC: `${name}@${spec}` } })
}

await h.ensure("Sync bun global packages", {
  want: wanted,
  check: async ({ read }) => toVersions(await read("bun pm ls -g")),
  fix: async ({ exec }, { extra, unmet }) => {
    const installs = Object.entries(unmet).map(([name, version]) => `${name}@${version}`)
    if (installs.length > 0) await exec(`bun add -g ${installs.join(" ")}`)
    if (Object.keys(extra).length > 0) await exec(`bun remove -g ${Object.keys(extra).join(" ")}`)
  },
})
```

The report shows a row per key that differs, from the host's value to the wanted one, in `want`'s key order, then the keys only the check found. A side without the key shows `(none)`, which says it has no value without saying what the fix does:

```
  ~ change: (ensure) Sync bun global packages
      zx:         (none) -> 8.8.1
      pnpm:       11.1.0 -> 11.2.0
      typescript: 5.9.2 -> (none)
```

A nested record shows its keys that differ under its own key, indented, with each level lined up on its own. A key whose record one side doesn't have at all shows that record's keys against `(none)`. A nested list shows a diff under its key, like a list `want`'s, with an object or an array item as one line of JSON. A nested set shows `missing:` and `extra:` rows under its key, like a set `want`'s. Two kinds of value at one key, like a string and a record, or a list and a set, show on one row, each as one line of JSON, with a `Set` as `Set [...]`:

```
  ~ change: (ensure) Configure the container
      image:   sonarr:4.0.14 -> sonarr:4.0.15
      env:
        TZ:   UTC -> America/New_York
        PUID: (none) -> 1000
      labels:
        traefik.enable: (none) -> true
      ports:
         80:80
        -8989:8989
        +8990:8989
      groups:
        missing: docker
        extra:   wheel
      aliases: ["sonarr"] -> Set ["sonarr"]
      restart: {"policy":"always"} -> unless-stopped
```

**A check reports the host's state, and never compares.** Its job is to return the same shape as `want`, filled with what's on the host. A check that returns a spec like `"latest"` when a package is current, and a version otherwise, does the comparison itself, and its row hides the installed version. Keep specs like `"latest"` or `"11"` as a helper's input, resolve them to versions for `want` before the step, as above, and have the check read the installed versions.

A command check is shorthand for calling `inspect` in a check function, so a non-zero exit is an answer, not a failure. `read` is the one that fails on a non-zero exit.

A broken check must not look converged. If the command exits non-zero and its output still matches `want`, as a string, a list, or a set, the step fails instead of reporting `unchanged`. A check whose non-zero exit is legitimate (`systemctl is-active` exits 3 for inactive) already produces output that differs from `want`, so this only catches the broken case.

`grep` is the exception to watch for. It exits 1 when nothing matches, which is an answer, not a failure, but it looks broken whenever no match is what you want. `grep -c '^#' file` with `want: "0"` prints `0` and exits 1, and `grep '^Port' file` with `want: []` prints nothing and exits 1, so both fail the step. When the question is only whether a line exists, use `grep -q` with a boolean `want`, which compares the exit code instead. When you need the output, add `|| [ $? -eq 1 ]`. It turns "no match" into exit 0, but a missing file or a bad pattern still exits non-zero, so a broken check still can't look converged. A bare `|| true` would make those exit 0 too.

There is no number form for a specific exit code. `want: 0` would mean the same as `want: true`, and the cases that need a specific code, like `systemctl is-active`, read better as output. It can be added later without breaking anything.

**A secret is checked on the host,** with an exit-code check and the secret in `secretEnv`, so no secret value is compared in TypeScript or shown as `got:` and `want:`:

```ts
await h.ensure("Set the API token", {
  want: true,
  check: 'grep -qxF "$TOKEN" ~/.config/app/token',
  fix: 'printf "%s\\n" "$TOKEN" > ~/.config/app/token',
  secretEnv: { TOKEN: token },
})
```

A string `want` that matches a known secret is still masked in the record, by value, but the exit-code check never puts it there.

**A check function** works out the answer in TypeScript, for state that is awkward to test in shell. It calls the `read` and `inspect` it is given, and returns the value compared to `want`: a boolean for a boolean `want`, and a string for a string `want`.

```ts
await h.ensure("Enable the app", {
  want: true,
  check: async ({ read }) => JSON.parse(await read("cat /etc/app/config.json")).enabled === true,
  fix: "...",
})

const latest = await latestCaddyVersion() // fetch() on the control machine
await h.ensure("Update Caddy", {
  want: latest,
  check: async ({ read }) => (await read("caddy version")).split(" ")[0] ?? "",
  fix: buildCaddy,
})
```

Return a string when the answer is a value, so a failure shows `got:` and `want:` lines instead of `got: false`. A string `want` means equal, so a check that is not an equality returns a boolean, like a minimum version:

```ts
await h.ensure("Install Caddy 2.8 or newer", {
  want: true,
  check: async ({ inspect }) => {
    const { stdout, exitCode } = await inspect("caddy version")
    if (exitCode !== 0) return false
    // `caddy version` prints "v2.8.4 h1:...".
    const [version = ""] = stdout.split(" ")
    return Bun.semver.satisfies(version, ">=2.8.0")
  },
  fix: buildCaddy,
})
```

`inspect` makes a missing `caddy` mean the fix is needed. With `read`, the same check would fail as broken.

Parse output in TypeScript, not in shell. Avoid `read("caddy version | cut -d' ' -f1")`. It hides the parsing on the host, and a `cut` that finds nothing still exits 0. Read the whole output and split it in the function, where the parsing runs on the control machine and can be tested.

A check function gets the broken-check rule for free, because the `read` it is given throws on a non-zero exit. Like any check, it also runs during `plan`, so it must not change what the script manages. If it throws, the step fails with the step's name in the error.

### What a check may change

A check runs in `plan`, so it must not change anything the script manages, or `plan` would make the changes it's meant to preview.

- **Refreshing metadata the check needs is fine.** `apt-get update` before listing upgrades only refreshes the list of what's available, and nothing installed or running changes. Without fresh lists, there's no way to answer the check.
- **Fetching or changing something a later step acts on breaks the rule.** `docker compose pull` moves the image tag on the host, so the next `docker compose up -d` from anywhere starts the new image, whether that's another step's fix, a manual command, or a restart after a reboot. `plan` would quietly stage an upgrade nobody applied. It also downloads on every `plan`, and each pull counts against Docker Hub's pull limit. Reading the registry's digest answers the same question without any of that.

Nothing enforces this, so a script can still choose to break it, knowing the cost (see the recipes).

Read inside the function, not before the step. The check runs again after the fix (see [Verification](#fix)). A value read before the step would still hold the state from before the fix, so the step would fail even when the fix worked.

### `fix`

`fix` is one command, or a function that runs several commands by calling `exec`. The function form is for one change that takes more than one command, where the halfway state is not something you would check:

```ts
await h.ensure("Install Caddy", {
  want: true,
  check: "dpkg -s caddy",
  fix: async ({ exec }) => {
    await exec("sudo apt-get update")
    await exec("sudo apt-get install -y caddy")
  },
})
```

Each `exec` call runs one command and returns its stdout, trimmed. A non-zero exit throws, which stops the fix there, and the error names the command. That replaces `set -e` or `&&` chains, and it puts TypeScript between the commands. A later command can use an earlier one's output:

```ts
fix: async ({ exec }) => {
  const id = await exec(`docker create ${image}`)
  await exec(`docker cp ./seed ${id}:/data`)
  await exec(`docker start ${id}`)
}
```

The fix function only runs in `apply`, so it can change things and do work on the control machine. A check function and a fix function can both log with `h.log`, and the message shows under the step (see [Messages](#messages)).

**What the check found.** A fix function gets a second argument after its tools, with `want` and what the check found, so a fix acts on the difference without reading the host again or comparing anything itself. The two sides come first, `got` then `want`, then what the comparison found:

- **A boolean `want`** gives `{ want }`.
- **A string or a list `want`** gives `{ got, want }`, with `got` what the check answered.
- **A set** gives `{ want, missing, extra }`. `missing` is what `want` has that the check didn't find, in `want`'s order, and `extra` is what the check found that `want` doesn't have, in the check's order.
- **A record** gives `{ got, want, unmet, extra, nestedExtra }`, which compare at any depth (see below).

```ts
await h.ensure("Update Caddy", {
  want: latest,
  check: async ({ read }) => (await read("caddy version")).split(" ")[0] ?? "",
  fix: async ({ exec }, { got }) => {
    await exec(`caddy-migrate --from ${got} --to ${latest}`)
  },
})
```

A record's parts:

- **`unmet` is `want` pruned to what the host doesn't match, at any depth,** in `want`'s key order. A nested record keeps only the keys that differ, and a nested set keeps only its missing items. Any other value stays whole: a string, a number, a boolean, `null`, a nested list, or a value of another kind than the host's. A key the host doesn't have holds its whole wanted value, so an empty record or set in `unmet` is one to create. For a flat record, `unmet` is every wanted key that's missing or differs, like the bun packages example above.
- **`extra` maps each top-level key `want` doesn't have to the host's value,** in the check's order.
- **`nestedExtra` lists what the host has inside the values `want` keeps,** where both sides are records or both are sets. `{ kind: "key", path, value }` is a key the host has in a nested record, with `path` from the top-level key down to it, like `["env", "DEBUG"]`. `{ kind: "items", path, value }` holds a nested set's extra items in the check's order, with `path` naming the set. The entries follow `want`'s key order, and a nested record's own extra keys come after the entries inside its wanted keys.
- **A list has no extras,** because a reorder or a duplicate isn't an item to remove. A fix writes a list whole. One that edits a list item by item, like inserting one entry, works it out from `got` and `want` itself.

```ts
import { pick } from "es-toolkit"

await h.ensure("Configure git", {
  want: { user: { name: "Alice" }, alias: { co: "checkout", st: "status" } },
  // Keep only the managed sections, because `git config` lists every one.
  check: async ({ read }) => pick(parseGitConfig(await read("git config --global --list")), ["user", "alias"]),
  fix: async ({ exec }, { unmet, nestedExtra }) => {
    // Only the keys that differ, like { alias: { st: "status" } }.
    for (const [section, keys] of Object.entries(unmet))
      for (const [key, value] of Object.entries(keys ?? {}))
        await exec(`git config --global ${section}.${key} '${value}'`)

    // The keys the host has in a wanted section, like ["alias", "lg"].
    for (const { path } of nestedExtra) await exec(`git config --global --unset ${path.join(".")}`)
  },
})
```

What the argument asks of a fix:

- **Write a whole value from `want`, not `unmet`.** A fix that replaces a nested value in one command, like a dict it writes whole, takes it from `want`, because `unmet` holds only the part that differs.
- **Remove where `want` stops.** What a fix removes is in `extra` and `nestedExtra`, so no fix walks `got` to find it.
- **A comparison that isn't plain equality belongs in the check.** The check returns the host's values in `want`'s form, like a name in the case `want` uses, or a number parsed from text (see "A check reports the host's state" above). A fix that compares values itself can disagree with the comparison, like on `-0`.
- **A list's fix writes the whole list.** A list whose order doesn't matter is a set, which gets `missing` and `extra`.

Why it's shaped this way:

- **Every fix gets `want`,** so a fix an integration passes on, or builds in code generic over `want`, needs nothing from its closure.
- **A set's `got` isn't passed,** because it's `want` minus `missing`, plus `extra`. A record's is, because `unmet` leaves out the host's values and nothing else holds them. A list's is, because `missing` and `extra` can't describe a reorder: with every item there but out of order, both would be empty.
- **It's a second argument, not part of the tools,** because the tools are what a fix can call, and this is data about one comparison.
- **Only a fix function gets it.** A command fix stays the form for simple cases, and a run's function gets only its tools.
- **It's fresh.** In `apply`, the comparison runs right before the fix, so `got` describes the host the fix changes. The check after the fix still catches a fix that acts on it and misses something.
- **The fix and the report read the same comparison,** so `plan` shows exactly what the fix acts on.
- **Its types follow `want`.** `got` and `want` have `want`'s type, `unmet` has `want`'s shape with every key optional, and the entries of `nestedExtra` are typed by the values `want` nests. Its type only has the entry kinds `want` can produce, so a `want` that nests no set gets only key entries, with no `kind` to check, and a `want` that can't nest a record or a set has no `nestedExtra` at all. Its types follow `want` 8 levels down, and past that its entries take any record value and any set item. `unmet`'s types have no limit.
- **Its types are exported.** `FixDifference<T>` is the argument for any `want`, and each kind's is `BooleanDifference`, `StringDifference`, `ListDifference`, `SetDifference`, or `RecordDifference`, with the entry types `NestedExtraKey` and `NestedExtraItems`. A `want` typed as the full `Want` union gets the union of them. So are the names a hover shows: each kind's `want` type (`BooleanWant`, `StringWant`, `ListWant`, `SetWant`, `RecordWant`), `RecordValue`, `RecordPrimitive`, `Fix`, `CheckFunction`, and `ChangeFunction`.

**One step or several.** A fix re-runs every command whenever its check fails. If one command's effect can be in place while the check still fails, that effect is state of its own, and it gets its own step. In the apt example, an updated package index does not matter, so running `apt-get update` again is harmless. This one is wrong:

```ts
await h.ensure("Set up Sonarr", {
  want: "active",
  check: "systemctl is-active sonarr",
  fix: async ({ exec }) => {
    await exec("sudo useradd --system sonarr")
    await exec("sudo install -d -o sonarr /var/lib/sonarr")
    await exec("sudo systemctl enable --now sonarr")
  },
})
```

If `systemctl` fails, the next run starts the fix from the top, and `useradd` fails because the user already exists, so the step can never finish. The check only covers the last piece, so a data dir with the wrong owner still reports `unchanged`. `plan` shows one line that does not say what is missing. Written as three steps, each piece has its own check, and each fix runs only when its own state is wrong:

```ts
await h.ensure("Create the sonarr user", { want: true, check: "id sonarr", fix: "sudo useradd --system sonarr" })
await h.ensure("Create the sonarr data dir", {
  want: "sonarr",
  check: "stat -c %U /var/lib/sonarr",
  fix: "sudo install -d -o sonarr /var/lib/sonarr",
})
await h.ensure("Start Sonarr", {
  want: "active",
  check: "systemctl is-active sonarr",
  fix: "sudo systemctl enable --now sonarr",
})
```

There is no list form of `fix`. A multi-line string runs like any shell script, so it carries on past a failed line unless it starts with `set -e`. Use the function form for anything past one command.

**`sudo`** goes in the command itself, only where it's needed, like `fix: "sudo apt-get install -y caddy"`. On a host that needs a sudo password, tsinfra supplies it (see [Transport](./transport.md#sudo)).

**Verification.** After a fix runs, the check runs again. If it still does not pass, the step fails with "the host's state still differs after the fix", followed by a `got:` and a `want:` row, which hold only the lines that differ for a multi-line string. A string shows as it is, and an empty one as `''` (see [CLI](./cli.md#how-the-report-is-built)). A boolean shows as `true` or `false`. An exit status shows as `exit code 1`, against `exit code 0` or `a non-zero exit code`. A `stderr:` row follows for the fix and the check when each ran one command that printed some, and names that command (see [CLI](./cli.md#output)). A step that reports a change on every run is a bug, and this is what surfaces it the first time.

```
the host's state still differs after the fix
  got:  exit code 0
  want: a non-zero exit code
```

`verify: false` skips the check after the fix, and the step reports `changed` as soon as the fix succeeds. It is for a fix whose effect nothing in the run can make visible, like one that needs a reboot or a new desktop login. The next run's check confirms it. Before reaching for it, try these:

- **Make the change take effect in the fix.** If one more command makes the effect visible, the fix runs it too. A resized swap file only shows in `swapon --show` once it is switched back on:

  ```ts
  await h.ensure("Resize swap", {
    want: "8G",
    check: "swapon --show=SIZE --noheadings --raw",
    fix: async ({ exec }) => {
      await exec("sudo swapoff /swapfile")
      await exec("sudo fallocate -l 8G /swapfile")
      await exec("sudo mkswap /swapfile")
      await exec("sudo swapon /swapfile")
    },
  })
  ```

- **Refresh after the step that needs it.** When another step's change needs a refresh, the refresh is a `run` after that step, not part of a later fix. `systemctl daemon-reload` follows the unit file it applies, so a unit change reloads even when the service is already running:

  ```ts
  const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit] })
  await h.ensure("Start Sonarr", {
    want: "active",
    check: "systemctl is-active sonarr",
    fix: "sudo systemctl enable --now sonarr",
  })
  ```

- **Check the stored state, not the current session.** After `usermod -aG docker sonarr`, plain `id` in an existing session does not show the group until a new login. `id -nG sonarr` reads the user database and shows it straight away.

**Plan mode** runs the check and never the fix. A step that would change reports `changed`.

## `run`

```ts
type RunOptions = EnvOptions & {
  after: ChangeStepResult<"file" | "link" | "dir" | "ensure" | "run">[] | "always" // run when any of these changed, or "always" on every pass
}
```

A step with no check: one command, or a function given `exec` for one action that takes several commands. `env` and `secretEnv` reach the command, or each `exec` in the function. Write `sudo` inside the command where it's needed. The function can log with `h.log`, and the message shows under the run (see [Messages](#messages)).

A run is for work that something in this run triggers, not the host's state. There are two kinds, and both go in `after`, which is required, so a forgotten trigger is a type error:

- **A follow-up to a change** takes `after`, the results of the steps it follows. It runs when any of them changed. Restarting a service after its config changed is one. No state on the host says a restart is needed, because a process started before the change looks the same as one started after it.
- **Unconditional upkeep** takes `after: "always"`, like `docker system prune -f`. A check for "anything to prune?" would cost as much as pruning. It reports `ranAlways`, and so does a run that follows only runs like it, because it runs on every pass too. `plan` shows it only from `-v`, because a run that happens on every apply is never news about the host.

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
const timer = await h.file("/etc/systemd/system/sonarr-backup.timer", backupTimer, { sudo: true })

await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit, timer] })
await h.run("Prune docker", "docker system prune -f", { after: "always" })
```

`after` only takes results from steps that can change the host, so a value from `h.read` cannot be a trigger. A step that only runs on some code paths goes in the same `if` as the run that follows it, so the run never refers to a step that didn't happen.

**A run that never got to run still triggers.** If a unit file changes and the run after it fails, or the host fails before the run, the next `apply` finds the file already right, but still triggers the reload (see [When an apply doesn't finish](#when-an-apply-doesnt-finish)).

|                                              | `apply`                            | `plan`                                                   |
| -------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `after`, one changed                         | runs, reports `ran`                | does not run, reports `ran` (a `>` line)                 |
| `after`, only `ranAlways` runs in it changed | runs, reports `ranAlways`          | does not run, reports `ranAlways` (a `>` line from `-v`) |
| `after`, an open change missing it           | runs, reports `ranFromOpenChanges` | does not run, reports `ranFromOpenChanges` (a `>` line)  |
| `after`, none changed or open for it         | does not run, reports `unchanged`  | does not run, reports `unchanged`                        |
| `after: "always"`                            | runs, reports `ranAlways`          | does not run, reports `ranAlways` (a `>` line from `-v`) |

A `ran` or `ranAlways` step returns `changed: true` in `plan` too, so one `run` can follow another (`after: [reload]`), and the plan shows the chain exactly as it would run for real.

A condition based on a fact, like the CPU architecture, is an `if` around the `run`, the same as for any other step. Prefer `after` over wrapping a run in `if (unit.changed)`. They decide the same thing, but with `after` tsinfra still knows the run exists when nothing changed, so verbose output can list it.

**Why a run is not an `ensure`.** A run is an `ensure` whose check is "did a trigger fire", with two differences:

- **There is no check after the fix.** "The unit changed" is still true after the reload, so the check would fail again and the step would fail.
- **It counts as drift only when open changes alone trigger it** (see [CLI](./cli.md#exit-codes)). An `"always"` run's check would never pass, so `plan` would exit 2 on every run. A follow-up usually triggers because a step it follows changed, and that step already counts. `plan` also hides a `ranAlways` run at the default level, so it isn't in the summary's count either, and a plan with nothing else reads `unchanged`.

Two actions are usually two runs, each with its own name in the output. The function form is for one action that takes several commands under one trigger:

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

The same works for steps with a check, as in `aptPackage(h, "caddy")`. Functions like these are how tsinfra gets integrations, whether you write them or tsinfra ships them (see [the roadmap](./roadmap.md#integrations-worth-shipping)).

Anything that can be checked should be an `ensure`, not a `run`. `after` keeps a check out of the trigger, but one can still hide in a run function:

```ts
await h.run(
  "Set up sonarr",
  async ({ exec }) => {
    if ((await exec("id -u sonarr || true")) === "") await exec("sudo useradd --system sonarr")
  },
  { after: "always" },
)
```

It works, but it never counts as drift, and `plan` shows it whether or not anything would change. Nothing can stop it, because a function can run any code.

### When an apply doesn't finish

A run with `after` triggers when a step it follows changed. When the run fails, or the apply stops before it, after another step's failure, Ctrl-C, or a dropped connection, the next `apply` finds those steps already right. Every other step reads the host's state, so the next apply finds whatever is left to do. Only a trigger, a step's `changed` used by a later step, exists in one apply alone. So tsinfra keeps the changes an apply made on the host, with the follow-ups that already ran after each one, until the host finishes an `apply` cleanly. Each is an **open change**. A follow-up is a step whose `after` names the steps it follows, like a `run`.

- **A change opens right before it's made:** before a step's fix, and before a run's command, so a run after a run can still trigger. Opening before the fix covers a connection that drops right after the fix succeeds. A step that was already right opens nothing.
- **Every changed step opens a change,** because tsinfra can't tell at that point whether a run follows it. A run names its steps only when the script reaches it. An open change that nothing follows has no effect.
- **Every fix opens a fresh change,** with no follow-ups listed, even when the step's change is already open, so its follow-ups trigger for the new change.
- **A run that succeeds is listed** on the open change of each step in its `after` that has one. A run that fails isn't, so it triggers again.
- **A clean `apply` closes every open change,** because every follow-up has had its turn. A host that fails keeps them. `plan` reads them and never writes them.

On the next pass, in `plan` or `apply`:

- **A step that's right, but whose change is still open, is `resume`.** It returns `changed: true`, so `after` and `if (x.changed)` treat it like a step that changed. The report shows it as `^ resume`, noted "an earlier apply didn't finish, so its follow-ups that didn't complete still trigger". A run that didn't trigger, but whose own change is still open, is `resume` too, so a run after it can trigger.
- **A run triggers** when a step in its `after` changed in this pass, or has an open change that doesn't list it. A run that only open changes trigger is `ranFromOpenChanges`. It shows as `> triggered`, noted "triggered because it didn't complete in an earlier unfinished apply", and counts as drift, because nothing in this pass explains it. A run that fails shows only its error, and the `resume` line before it says why it ran.
- **`needs` doesn't wait on a `resume` step,** because its change is already on the host.

The open changes live in the host's saved state (see [Transport](./transport.md#saved-state)). What they cost:

- **A run that already ran triggers again** when it was renamed since, because the open change doesn't list its new name. Runs are meant to be safe to repeat.
- **A renamed change step loses its open change,** which is how every trigger works without them.
- **A changed step opens its change with one more command,** and a run that follows an open change records itself with another.
- **Two control machines applying to one host at once can race** on the saved state. tsinfra has no locking.

## Messages

`h.log` adds something of the script's own to the report, like a setting it found somewhere other than where the script declared it, or a section it skipped because of something it read. A `console.log` writes into the middle of tsinfra's output, so a script logs with `h.log` instead.

```ts
const release = await h.read("lsb_release -rs")
if (release === "11") h.log.info("Debian 11, so the Incus setup is skipped")
else await setUpIncus(h)
```

- **`h.log.info(message)` and `h.log.warn(message)`** are the two kinds of message. A warning shows at the default level, and the summary counts it with the other warnings, like `unchanged, 1 warning`. An info shows from `-v`, with the steps that were already right, so an info added while debugging a script doesn't clutter the default output. A message isn't drift, so it never changes the exit code.
- **It's synchronous,** because it runs nothing on the host, so it needs no `await`. It records the same thing in `plan` and `apply`.
- **A message logged outside a step** shows on its own line, in script order with the steps around it, like `- warning: the old unit is still there`. A remark about the host as a whole goes at the top or the bottom of the host function.
- **A message a step's function logs** belongs to that step, because steps run one at a time, so the step that's running is the one that logged it. A fix logs only in `apply`, because `plan` never runs it, and a waiting step runs no functions. It shows under its step, as `warning: <text>` or `info: <text>`, at the same levels as a message outside a step, so a warning brings up a step that was already right.
- **Each distinct message shows once under its step.** An `ensure` check runs before and after the fix in `apply`, so a check that logs the same thing both times shows it once, and one that logs something new after the fix shows that too. The summary counts a step's warning once, however many times it was logged.
- **From `-vv`, every message shows among the step's commands,** where it was logged, duplicates included, so it's clear which pass logged what. At `-vvv`, each one sits under the heading of the phase that logged it (see [CLI](./cli.md#output)).
- **A failed step keeps its messages.** The script wrote them, and they often explain the failure. The ones it logged before it failed show, and the ones after the failure never ran.

```ts
await h.ensure("Set the API key", {
  want: true,
  check: async ({ read }) => {
    const override = await read("grep -c '^API_KEY=' /etc/sonarr/env || true")
    if (override !== "0") h.log.warn("/etc/sonarr/env also sets API_KEY, and it wins")
    return (await read("grep -c '<ApiKey>' /var/lib/sonarr/config.xml || true")) === "1"
  },
  fix: async ({ exec }) => { ... },
})
```

```
sonarr                                                    # default
  = unchanged: (ensure) Set the API key
      warning: /etc/sonarr/env also sets API_KEY, and it wins

sonarr                                                    # -vv
  = unchanged: (ensure) Set the API key
      commands:
        (read) $ grep -c '^API_KEY=' /etc/sonarr/env || true
        warning: /etc/sonarr/env also sets API_KEY, and it wins
        (read) $ grep -c '<ApiKey>' /var/lib/sonarr/config.xml || true
```

- **It's on `h`,** not imported from `tsinfra`, so it always knows which host logged, and an integration that takes `h` can log too.
- **A secret in a message is `[MASKED]`,** like one in a command's output.
- **A message must be a non-empty string.** Anything else fails the host and throws, like a bad argument to a step, and inside a step's function it fails that step. After the host has failed, `h.log` throws the host's failure, like every other call on `h`.

## Failure

Scripts never check results for errors. When a call on `h` fails, the host is marked failed and the call throws, which stops the script at that point. The CLI reports the host as failed, with the call that failed and its output.

Catching the error does not recover the host. It stays failed, and every later call on `h` throws the same error straight away without touching the host. Code between the catch and the next call on `h` still runs, so do not catch around calls on `h`. The same holds inside a check, fix, or run function. A step or run whose function catches a failed `read` or `exec` still fails. A command whose non-zero exit is a legitimate answer goes through `inspect`.

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

Catching anything that doesn't come from `h` or a tool works as usual, like a `fetch` in the script that falls back to another URL. tsinfra never sees that error.

If the host function throws for any other reason (a bug in the script), the CLI catches it and reports the host as failed in the same way.

## What `plan` can and cannot show

`plan` reads every step's state from the machine as it is now. A step after a step that would change reads the old state, not the state that step would leave behind. For most steps that does not matter. Where it does, a [need](./needs.md) is how you say so, and `plan` then shows the step as waiting instead of a misleading answer.

When any step's state differed, `plan` adds a reminder before the summary: "Steps after a change were checked without that change, so apply may differ." Terraform's "known after apply" is the same problem. Terraform knows which values depend on which resources, so it can mark exactly those. tsinfra does not know which steps depend on each other, so it warns in general, unless a step's `needs` says so.
