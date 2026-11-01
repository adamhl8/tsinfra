# Steps

Everything a host script does to a target goes through `h`, the context passed to the host function.

<!-- toc -->

- [Choosing a method](#choosing-a-method)
- [Commands](#commands)
- [Steps](#steps)
  - [`ensure`](#ensure)
  - [`fix`](#fix)
- [`file`](#file)
- [`run`](#run)
- [`read`](#read)
- [`inspect`](#inspect)
- [Failure](#failure)
- [What `plan` can and cannot show](#what-plan-can-and-cannot-show)

<!-- tocstop -->

```ts
interface Host {
  readonly name: string // the host file's name, e.g. "sonarr"
  ensure(name: string, options: EnsureOptions): Promise<StepResult>
  file(path: string, options: FileOptions): Promise<StepResult>
  run(name: string, cmd: string | ((tools: ExecTools) => Promise<void>), options: RunOptions): Promise<StepResult>
  read(cmd: string, options?: CommandOptions): Promise<string>
  inspect(cmd: string, options?: CommandOptions): Promise<CommandResult>
}

// Given to a check function. These are the same as `h.read` and `h.inspect`.
type ReadTools = { read: Read; inspect: Inspect }

// Given to a fix or run function.
type ExecTools = { exec: Exec; inspect: Inspect }

// Runs one command and returns its stdout.
type Read = (cmd: string, options?: CommandOptions) => Promise<string>

// Runs one command and returns its output and exit code, without failing on a non-zero exit.
type Inspect = (cmd: string, options?: CommandOptions) => Promise<CommandResult>

// Runs one command that changes the target, and returns its stdout. It behaves the same as `Read`.
type Exec = (cmd: string, options?: CommandOptions) => Promise<string>

type CommandOptions = {
  sudo?: boolean // run as root through `sudo -n`
  secret?: boolean // keep the command and its output out of the output and errors
}

type CommandResult = {
  stdout: string // trailing newlines stripped
  stderr: string
  exitCode: number
}

type StepResult = {
  name: string // shown when another step waits on this one
  changed: boolean // the step changed something, would change it in plan, or waits on a required step
}
```

`changed` is what lets a script react to a step, as in `h.run(..., { after: [unit] })`. In plan mode it means
"would change", so the follow-up shows up in the plan as a `>` line exactly when it would run for real.

Scripts only see `changed`. They cannot tell a real change from a would-be one, so they cannot branch on the mode and
make the plan differ from what `apply` does. The output shows each step's full status: ok, changed, would change,
waiting, or failed.

## Choosing a method

An `ensure` is the if statement you would write without `plan`, like `if (!(await isInstalled())) await install()`.
The difference is that tsinfra gets the condition and the body separately. That lets it run only the condition in
`plan`, run the condition again after the body in `apply`, and count a condition that did not pass as drift.

So plain TypeScript control flow is fine in a host script, except for one decision: whether a change is needed. That
decision belongs in a step's check, where tsinfra can see it.

| When the code...                       | Use                                                    |
| -------------------------------------- | ------------------------------------------------------ |
| changes state that can be checked      | [`ensure`](#ensure), or [`file`](#file) for a file     |
| follows up on a change, or always runs | [`run`](#run) with `after` or `always`                 |
| picks which steps apply                | [`read`](#read) or [`inspect`](#inspect), plus an `if` |

A fact that picks steps is one that no step on the host changes, like the CPU architecture or whether the host is a
container. Branching on state that an earlier step changes runs into
[what `plan` cannot show](#what-plan-can-and-cannot-show).

A fact that only shapes one step is read inside that step's function, not at the top level. When a download URL
depends on the CPU architecture, the fix that downloads it reads the architecture. That read only runs when the fix
does, and it is recorded under that step. `h.read` and `h.inspect` are for facts that decide which steps exist, because
a step's function cannot call `h`.

The wrong shape for a change is a read, an `if`, and a `run`:

```ts
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) await h.run("Install docker", installDocker, { always: true })
```

It mostly works. `plan` runs the inspect and shows the run when docker is missing. What it loses is the check after the
fix, the drift exit code, and the step's line in verbose output when docker is already there. Nothing looks broken,
which is why the table matters. The same step as an `ensure`:

```ts
await h.ensure("Install docker", { check: "command -v docker", want: true, fix: installDocker })
```

## Commands

Everything that runs on the target takes one command at a time, so you never have to write a multi-line shell script.
Shell is for basic commands like `systemctl` or `docker compose`. Work out values in TypeScript, not with pipes and
`cut`.

Two shapes follow from that:

- **Computing a value** (a step's `check`) takes a command, or a function given `read` and `inspect` that returns the
  value. The function calls them as many times as it needs. It also runs during `plan`, so it must not change
  anything.
- **Changing the target** (a step's `fix`, and `run`) takes a command, or a function given `exec` and `inspect`. The
  function calls `exec` once per command that changes the target. It only runs in `apply`.

`read`, `inspect`, and `exec` are the tools. Each runs one command and takes `CommandOptions`. `read` and `exec` return
stdout and fail on a non-zero exit. `inspect` never fails on a non-zero exit, for a command whose exit code or stderr is
the answer.

`read` and `exec` behave the same, and the name says which mode the function runs in. A check function also runs in
`plan`, so it gets `read` and `inspect`, the same pair `h` has. A fix or run function only runs in `apply`, so it gets
`exec` and `inspect`. Each function gets one tool that fails on a non-zero exit and one that does not. A function gets
its tools in an object, as in `async ({ read }) =>` or `async ({ exec }) =>`, so tools can be added later without
changing existing scripts. `exec` is not `h.run`. A run is a
step with its own name in the output, and a command inside a fix is part of one change that the step's name already
covers.

**An option takes a function when tsinfra decides when, or whether, it runs.** `check` runs in both modes and again
after the fix. `fix` and a run's command run only in `apply`, and only when needed. Every other option is a plain value
that your script computes before the call: `want`, `requires`, `after`, and `file`'s `content`. A `want` that depends on
the target belongs in the check, which reads both values and returns the comparison. `h.read` and `h.inspect` run
straight away, so they take a command, not a function. Combining several reads is ordinary code at the top level.

**A function holds commands, not decisions.** A fix or run function that tests the machine before acting is an
`ensure` step in disguise (see [`run`](#run)).

**`h` is for the top level.** Inside a check, fix, or run function, use only the tools the function is given.
Every method on `h` fails the host while another step is running, with an error like `'read' can't run while step
'A' is running`. When the running step is a read, the error names its command instead, as in `read 'uname -m'`. That
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
[`read`](#read) is a step that only observes. The others can change the target, and each returns a `StepResult`.

Most steps that can change the target check one piece of state, and in `apply` run a fix when the check fails. `ensure`
is the step you write the check for. [`file`](#file) is a step whose check tsinfra writes.
[`run`](#run) is a step with no check.

```ts
type FixOptions = {
  fix: string | ((tools: ExecTools) => Promise<void>)
  sudo?: boolean // run a string fix under sudo
  verify?: boolean // default true
  secret?: boolean // hide the diff
  requires?: (StepResult | undefined)[] // earlier steps this step's check depends on
}

type EnsureOptions = FixOptions & (ExitCheck | OutputCheck)

// `want: true` means exit 0, or a function returning true, is already right. `want: false` means the opposite.
type ExitCheck = {
  check: string | ((tools: ReadTools) => Promise<boolean>)
  want: boolean
}

// The command's stdout, or the function's value, is compared to `want`.
type OutputCheck = {
  check: string | ((tools: ReadTools) => Promise<string>)
  want: string
}
```

Name a step like a function, starting with a verb ("Install Caddy"), or as the state it ensures ("Caddy is installed").
Both read well after `ensure`.

### `ensure`

`check` runs on the target, and `want` is the answer it gives when the state is already right. When they match, nothing
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
too means a value built from a template literal that ends in a newline still matches. When they differ, `plan` shows a
line diff.

```ts
await h.ensure("Start Sonarr", {
  check: "systemctl is-active sonarr",
  want: "active",
  fix: "sudo systemctl enable --now sonarr",
})
```

A broken check must not look converged. If the command exits non-zero and its output still equals `want`, the step
fails instead of reporting ok. A check whose non-zero exit is legitimate (`systemctl is-active` exits 3 for inactive)
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
target, and a `cut` that finds nothing still exits 0. Read the whole output and split it in the function, where the
parsing runs on the control machine and can be tested.

A check function gets the broken-check rule for free, because the `read` it is given throws on a non-zero exit. Like
any check, it also runs during `plan`, so it must not change anything. If it throws, the step fails with the step's
name in the error.

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

Each `exec` call runs one command and returns its stdout, with trailing newlines stripped. A non-zero exit throws, which
stops the fix there, and the error names the command. That replaces `set -e` or `&&` chains, and it puts TypeScript
between the commands. A later command can use an earlier one's output:

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
the step can never finish. The check only covers the last piece, so a data dir with the wrong owner still reports ok.
`plan` shows one line that does not say what is missing. Written as three steps, each piece has its own check, and each
fix runs only when its own state is wrong:

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

**`sudo: true`** runs a string fix under `sudo`. In a fix function, pass `{ sudo: true }` to each `exec` that needs it.

**Verification.** After a fix runs, the check runs again. If it still does not pass, the step fails with "the check for
step '...' still fails after the fix", plus the details: `got:` and `want:` lines for a string `want`, and the exit code
and stderr of a command that exited non-zero. A step that reports a change on every run is a bug, and this is what
surfaces it the first time.

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
  const unit = await h.file("/etc/systemd/system/sonarr.service", { content: sonarrUnit, sudo: true })
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

**Plan mode** runs the check and never the fix. A step that would change reports `would-change`.

## `file`

```ts
type FileOptions = {
  content: string | Buffer // computed on the control machine
  mode?: string // octal, default "644", or "600" when secret
  owner?: string // managed only when given
  group?: string // managed only when given
  sudo?: boolean
  secret?: boolean
  requires?: (StepResult | undefined)[]
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
type RunOptions = CommandOptions
  & (
    | { after: (StepResult | undefined)[] } // run when any of these changed
    | { always: true } // run on every pass
  )
```

A step with no check: one command, or a function given `exec` for one action that takes several commands. `sudo` and
`secret` apply to a string command. A function passes them to each `exec`.

A run is for work that something in this run triggers, not the host's state. There are two kinds, and `run` takes
exactly one of `after` or `always`, so a forgotten trigger is a type error:

- **A follow-up to a change** takes `after`, the results of the steps it follows. It runs when any of them changed.
  Restarting a service after its config changed is one. No state on the host says a restart is needed, because a
  process started before the change looks the same as one started after it.
- **Unconditional upkeep** takes `always: true`, like `docker system prune -f`. A check for "anything to prune?" would
  cost as much as pruning.

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", { content: sonarrUnit, sudo: true })
const timer = await h.file("/etc/systemd/system/sonarr-backup.timer", { content: backupTimer, sudo: true })

await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit, timer] })
await h.run("Prune docker", "docker system prune -f", { always: true })
```

`after` only takes step results, so a value from `h.read` cannot be a trigger. It also takes `undefined`, so a step
that only runs on some code paths can be passed as it is, as in `after: [unit]` when `unit` is
`StepResult | undefined`.

|                       | `apply`                    | `plan`                                            |
| --------------------- | -------------------------- | ------------------------------------------------- |
| `after`, one changed  | runs, reports `changed`    | does not run, reports `would-change` (a `>` line) |
| `after`, none changed | does not run, reports `ok` | does not run, reports `ok`                        |
| `always: true`        | runs, reports `changed`    | does not run, reports `would-change` (a `>` line) |

Because `changed` is true for `would-change`, one `run` can follow another (`after: [reload]`), and the plan shows the
chain exactly as it would run for real.

A condition based on a fact, like the CPU architecture, is an `if` around the `run`, the same as for any other step.
Prefer `after` over wrapping a run in `if (unit.changed)`. They decide the same thing, but with `after` tsinfra still
knows the run exists when nothing changed, so verbose output can list it.

**Why a run is not an `ensure`.** A run is an `ensure` whose check is "did a trigger fire", with two differences:

- **There is no check after the fix.** "The unit changed" is still true after the reload, so the check would fail
  again and the step would fail.
- **It never counts as drift** (see [CLI](./cli.md#exit-codes)). An `always` run's check would never pass, so `plan`
  would exit 2 on every run. A follow-up only fires when a step it follows changed, and that step already counts.

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
const updateComposeStack = async (h: Host, after: StepResult[]) => {
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
  { always: true },
)
```

It works, but it never counts as drift, and `plan` shows it whether or not anything would change. Nothing can stop it,
because a function can run any code.

## `read`

Runs a command on the target in both modes and returns its output, with trailing newlines stripped. Each `h.read` is a
step of its own. It has no name, so errors and verbose output show its command. It is for observations a script
branches on:

```ts
const arch = await h.read("uname -m")
const firewall = await h.read("ufw status", { sudo: true })
```

A non-zero exit fails the host, with the command's stderr. When the exit code or stderr is the answer, use
[`inspect`](#inspect). A `read` must not change anything, because it also runs during `plan`. Nothing can enforce that.

`secret: true` keeps the command out of errors and output, for a command that carries a token. The output itself is
only ever returned to the script.

## `inspect`

Runs a command on the target in both modes and returns its stdout, stderr, and exit code. It never fails on a non-zero
exit, so it suits a command whose exit code is the answer, and one that prints the answer on stderr, like
`java -version`. Like `read`, it is a step of its own with no name, and it must not change anything.

```ts
const container = await h.inspect("systemd-detect-virt --container")
if (container.exitCode !== 0) await tuneKernel(h)
```

Check, fix, and run functions get an `inspect` tool too. A command that could not run at all, like one on an unreachable
host, still fails the host.

`read` stays the default and keeps returning a string, because most reads only want stdout, and a failed `read` means
something is broken. An option on `read` that changed its return type would need overloads.

## Failure

Scripts never check results for errors. When a call on `h` fails, the host is marked failed and the call throws, which
stops the script at that point. The CLI reports the host as failed, with the call that failed and its output.

Catching the error does not recover the host. It stays failed, and every later call on `h` throws the same error
straight away without touching the target. Code between the catch and the next call on `h` still runs, so do not catch
around calls on `h`. The same holds inside a check, fix, or run function. A step or run whose function catches a failed
`read` or `exec` still fails. A command whose non-zero exit is a legitimate answer goes through `inspect`.

If the host function throws for any other reason (a bug in the script), the CLI catches it and reports the host as
failed in the same way.

## What `plan` can and cannot show

`plan` runs every check against the machine as it is now. A step after a would-change step is checked against the old
state, not the state that step would leave behind. For most steps that does not matter. Where it does, a
[requirement](./requirements.md) is how you say so, and `plan` then shows "waits on" instead of a misleading answer.

When any check did not pass, `plan` adds a reminder before the summary: "Steps after a change were checked without
that change, so apply may differ." Terraform's "known after apply" is the same problem. Terraform knows which values
depend on which resources, so it can mark exactly those. tsinfra does not know which steps depend on each other, so it
warns in general, unless a step's `requires` says so.
