# Steps

Everything a host script does to a target goes through `h`, the context passed to the host function.

<!-- toc -->

- [Commands](#commands)
- [Steps](#steps)
  - [`ensure`](#ensure)
  - [`ensureValue`](#ensurevalue)
  - [`fix`](#fix)
- [`file`](#file)
- [`run`](#run)
- [`read`](#read)
- [Failure](#failure)
- [What `plan` can and cannot show](#what-plan-can-and-cannot-show)

<!-- tocstop -->

```ts
interface Host {
  readonly name: string // the host file's name, e.g. "sonarr"
  ensure(name: string, options: EnsureOptions): Promise<StepResult>
  ensureValue(name: string, options: EnsureValueOptions): Promise<StepResult>
  file(path: string, options: FileOptions): Promise<StepResult>
  run(name: string, cmd: string | ((tools: ExecTools) => Promise<void>), options: RunOptions): Promise<StepResult>
  read(cmd: string, options?: CommandOptions): Promise<string>
}

// Given to a check or read function.
type ReadTools = { read: Read }

// Given to a fix or run function.
type ExecTools = { exec: Exec }

// Runs one command inside a check or read function, and returns its stdout.
type Read = (cmd: string, options?: CommandOptions) => Promise<string>

// Runs one command inside a fix or run function, and returns its stdout.
type Exec = (cmd: string, options?: CommandOptions) => Promise<string>

type CommandOptions = {
  sudo?: boolean // run as root through `sudo -n`
  secret?: boolean // keep the command and its output out of the output and errors
}

type StepResult = {
  changed: boolean // the step changed something, would change it in plan, or waits on a requirement
}
```

`changed` is what lets a script react to a step, as in `h.run(..., { when: unit.changed })`. In plan mode it means
"would change", so the follow-up shows up in the plan as "would run" exactly when it would run for real.

Scripts only see `changed`. They cannot tell a real change from a would-be one, so they cannot branch on the mode and
make the plan differ from what `apply` does. The output shows each step's full status: ok, changed, would change,
waiting, or failed.

## Commands

Everything that runs on the target takes one command at a time, so you never have to write a multi-line shell script.
Shell is for basic commands like `systemctl` or `docker compose`. Work out values in TypeScript, not with pipes and
`cut`.

Two shapes follow from that:

- **Computing a value** (a step's `check` and `read`) takes a command, or a function given `read` that returns the
  value. The function calls `read` as many times as it needs. It also runs during `plan`, so it must not change
  anything.
- **Changing the target** (a step's `fix`, and `run`) takes a command, or a function given `exec`. The function calls
  `exec` once per command. It only runs in `apply`.

`read` and `exec` are the primitives. Each runs one command, returns its stdout, and takes `CommandOptions`. A function
gets its tool in an object, as in `async ({ read }) =>` or `async ({ exec }) =>`, so tools can be added later without
changing existing scripts. Inside a fix, `exec` is also how you read the target, because it returns stdout. `exec` is
not `h.run`. A run is a step with its own name in the output, and a command inside a fix is part of one change that the
step's name already covers.

**A function holds commands, not decisions.** A fix or run function that tests the machine before acting is an
`ensure` step in disguise (see [`run`](#run)).

**`h` is for the top level.** Inside a check, read, fix, or run function, use only the tools the function is given.
Every method on `h` fails the host while a step is running, with an error like `'h.read' can't run while step 'A' is
running`. That rules out these mistakes:

- **A step inside a step.** A step inside a fix never shows in `plan`, because `plan` never runs the fix. A step inside
  a check runs its fix while checking.
- **`h.read` inside a check or read function.** The function's own `read` does the same job, so there is one way to
  read inside a step.
- **Steps side by side.** Steps on one host run one at a time, so `Promise.all` over steps fails as soon as the second
  one starts. Commands inside one step can still run at once, with `Promise.all` over `exec` in a fix.

A check or read function runs in `plan`, so a mistake there shows up on the first `plan`. A fix or run function only
runs in `apply`, so a mistake there shows up in `apply`.

## Steps

A step is anything on `h` that can change the target. Most steps check one piece of state, and in `apply` run a fix
when the check fails. `ensure` and `ensureValue` are steps you write the check for. [`file`](#file) is a step whose
check tsinfra writes. [`run`](#run) is a step with no check. Every step returns a `StepResult`. `h.read` is not a step,
because it only observes.

```ts
type FixOptions = {
  fix: string | ((tools: ExecTools) => Promise<void>)
  noop?: string // message shown when already right, in verbose output
  sudo?: boolean // run a string fix under sudo
  verify?: boolean // default true
  secret?: boolean // hide the diff
  requires?: Need[]
  provides?: Need[]
}

type EnsureOptions = FixOptions & {
  check: string | ((tools: ReadTools) => Promise<boolean>) // exit 0, or true, means already right
}

type EnsureValueOptions = FixOptions & {
  read: string | ((tools: ReadTools) => Promise<string>) // compared to `want`
  want: string
}
```

Name a step like a function, starting with a verb ("Install Caddy"), or as the state it ensures ("Caddy is installed").
Both read well after `ensure`.

### `ensure`

`check` is a command whose exit status is the answer. Exit 0 means the state is already right and nothing happens.
Anything else means the fix runs. There is nothing to diff, so `plan` shows only the step's name. This is the shape of
`converge` in the pyinfra helper, and it suits state that only answers yes or no, like `brew bundle check`.

```ts
await h.ensure("Install Caddy", { check: "dpkg -s caddy", fix: "sudo apt-get install -y caddy" })
```

`check` can also be a function that returns `true` when the state is already right. It calls the `read` it is given
and works out the answer in TypeScript, for state that is awkward to test in shell:

```ts
await h.ensure("Enable the app", {
  check: async ({ read }) => JSON.parse(await read("cat /etc/app/config.json")).enabled === true,
  fix: "...",
})
```

Like any check, it also runs during `plan`, so it must not change anything. If it throws, the step fails with the
step's name in the error.

Read inside the function, not before the step. The check runs again after the fix (see [Verification](#fix)). A value
read before the step would still hold the state from before the fix, so the step would fail even when the fix worked.

### `ensureValue`

`read` and `want` compare a command's output to a value. `read` runs on the target and `want` is computed in your
script on the control machine. Trailing newlines are stripped from both (the way `$(cmd)` does), then the two are
compared exactly. Stripping `want` too means a value built from a template literal that ends in a newline still matches.
When they differ, `plan` shows a line diff.

```ts
await h.ensureValue("Start Sonarr", {
  read: "systemctl is-active sonarr",
  want: "active",
  fix: "sudo systemctl enable --now sonarr",
})
```

Like `check`, `read` can also be a function, here one that returns the value to compare. It suits values that are
easier to pull out in TypeScript than in shell:

```ts
const latest = await latestCaddyVersion() // fetch() on the control machine
await h.ensureValue("Update Caddy", {
  read: async ({ read }) => (await read("caddy version")).split(" ")[0] ?? "",
  want: latest,
  fix: buildCaddy,
})
```

A broken `read` must not look converged. If `read` exits non-zero and its output still equals `want`, the step fails
instead of reporting ok. A read whose non-zero exit is legitimate (`systemctl is-active` exits 3 for inactive) already
produces output that differs from `want`, so this only catches the broken case. A function `read` gets this for free,
because the `read` it is given throws on a non-zero exit.

### `fix`

`fix` is one command, or a function that runs several commands by calling `exec`. The function form is for one change
that takes more than one command, where the halfway state is not something you would check:

```ts
await h.ensure("Install Caddy", {
  check: "dpkg -s caddy",
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
await h.ensure("Create the sonarr user", { check: "id sonarr", fix: "sudo useradd --system sonarr" })
await h.ensureValue("Create the sonarr data dir", {
  read: "stat -c %U /var/lib/sonarr",
  want: "sonarr",
  fix: "sudo install -d -o sonarr /var/lib/sonarr",
})
await h.ensure("Start Sonarr", { check: "systemctl is-active sonarr", fix: "sudo systemctl enable --now sonarr" })
```

There is no list form of `fix`. A multi-line string runs like any shell script, so it carries on past a failed line
unless it starts with `set -e`. Use the function form for anything past one command.

**`sudo: true`** runs a string fix under `sudo`. In a fix function, pass `{ sudo: true }` to each `exec` that needs it.

**Verification.** After a fix runs, the check runs again. If it still does not pass, the step fails with "the check for
step '...' still fails after the fix", plus the details: the read and want values for `ensureValue`, and the exit code
and stderr of a command that exited non-zero. A step that reports a change on every run is a bug, and this is what
surfaces it the first time.

`verify: false` skips the check after the fix, and the step reports `changed` as soon as the fix succeeds. It is for a
fix whose effect nothing in the run can make visible, like one that needs a reboot or a new desktop login. The next
run's check confirms it. Before reaching for it, try these:

- **Make the change take effect in the fix.** If one more command makes the effect visible, the fix runs it too. A
  resized swap file only shows in `swapon --show` once it is switched back on:

  ```ts
  await h.ensureValue("Resize swap", {
    read: "swapon --show=SIZE --noheadings --raw",
    want: "8G",
    fix: async ({ exec }) => {
      await exec("sudo swapoff /swapfile")
      await exec("sudo fallocate -l 8G /swapfile")
      await exec("sudo mkswap /swapfile")
      await exec("sudo swapon /swapfile")
    },
  })
  ```

- **Refresh after the step that needs it.** When another step's change needs a refresh, the refresh is a `run` guarded
  by that step, not part of a later fix. `systemctl daemon-reload` follows the unit file it applies, so a unit change
  reloads even when the service is already running:

  ```ts
  const unit = await h.file("/etc/systemd/system/sonarr.service", { content: sonarrUnit, sudo: true })
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { when: unit.changed })
  await h.ensure("Start Sonarr", { check: "systemctl is-active sonarr", fix: "sudo systemctl enable --now sonarr" })
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
type RunOptions = CommandOptions & {
  when: boolean // run on this pass
  requires?: Need[]
  provides?: Need[]
}
```

A step with no check: one command, or a function given `exec` for one action that takes several commands. `sudo` and
`secret` apply to a string command. A function passes them to each `exec`. `when` is required, so every `run` says when
it runs. Unconditional work is `when: true`, written out rather than assumed, so a forgotten guard is a type error
instead of a command that quietly runs every time.

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", { content: sonarrUnit, sudo: true })
const timer = await h.file("/etc/systemd/system/sonarr-backup.timer", { content: backupTimer, sudo: true })

await h.run("Reload systemd", "sudo systemctl daemon-reload", { when: unit.changed || timer.changed })
await h.run("Prune docker", "docker system prune -f", { when: true })
```

`when` is a plain boolean, so `||`, `&&`, and `?.` cover any condition. A step that only runs on some code paths is
`unit?.changed ?? false`.

|               | `apply`                    | `plan`                                             |
| ------------- | -------------------------- | -------------------------------------------------- |
| `when: true`  | runs, reports `changed`    | does not run, reports `would-change` ("would run") |
| `when: false` | does not run, reports `ok` | does not run, reports `ok`                         |

Because `changed` is true for `would-change`, one `run` can guard another (`when: reload.changed`), and the plan shows
the chain exactly as it would run for real.

Prefer `when` over wrapping a single `run` in an `if`. They decide the same thing, but with `when: false` tsinfra still
knows the run exists, so verbose output can list it. An `if` fits around a block of steps that only applies to some
machines.

**Drift.** A `run` never counts toward `plan` exiting 2 (see [CLI](./cli.md#exit-codes)). It has no check, so it cannot
see drift. A run guarded by a step with a check only fires when that step changes, and that step already counts. A
`when: true` run is a deliberate choice to run every time, which says nothing about the machine's state.

Two actions are usually two runs, each with its own name in the output. The function form is for one action that takes
several commands under one `when`:

```ts
await h.run(
  "Update the stack",
  async ({ exec }) => {
    await exec("docker compose pull")
    await exec("docker compose up -d")
  },
  { when: compose.changed },
)
```

A function that takes `h` shares steps between hosts:

```ts
const updateComposeStack = async (h: Host, when: boolean) => {
  await h.run("Pull images", "docker compose pull", { when })
  await h.run("Start the stack", "docker compose up -d", { when })
}

await updateComposeStack(h, compose.changed)
```

The same works for steps with a check, as in `aptPackage(h, "caddy")`. Helpers like these are how tsinfra gets modules,
whether you write them or tsinfra ships them (see [Open questions](./open-questions.md#helpers-worth-shipping)).

Anything that can be checked should be an `ensure` or `ensureValue` step, not a `run`. That includes a check hidden in
`when`, like `when: (await h.read("...")) !== "x"`, and one hidden in a run function:

```ts
await h.run(
  "Set up sonarr",
  async ({ exec }) => {
    if ((await exec("id -u sonarr || true")) === "") await exec("sudo useradd --system sonarr")
  },
  { when: true },
)
```

Both work, but they never count as drift, and `plan` says "would run" whether or not anything would change.

## `read`

Runs a command on the target in both modes and returns its output, with trailing newlines stripped. It is for
observations a script branches on:

```ts
const arch = await h.read("uname -m")
const firewall = await h.read("ufw status", { sudo: true })
```

A non-zero exit fails the host, with the command's stderr. Append `|| true` when a non-zero exit is a legitimate
answer. A `read` must not change anything, because it also runs during `plan`. Nothing can enforce that.

`secret: true` keeps the command out of errors and output, for a command that carries a token. The output itself is
only ever returned to the script.

## Failure

Scripts never check results for errors. When a call on `h` fails, the host is marked failed and the call throws, which
stops the script at that point. The CLI reports the host as failed, with the call that failed and its output.

Catching the error does not recover the host. It stays failed, and every later call on `h` throws the same error
straight away without touching the target. Code between the catch and the next call on `h` still runs, so do not catch
around calls on `h`. The same holds inside a check, read, fix, or run function. A step or run whose function catches a
failed `read` or `exec` still fails. A command whose non-zero exit is a legitimate answer says so itself, with `||
true`.

If the host function throws for any other reason (a bug in the script), the CLI catches it and reports the host as
failed in the same way.

## What `plan` can and cannot show

`plan` runs every check against the machine as it is now. A step after a would-change step is checked against the old
state, not the state that step would leave behind. For most steps that does not matter. Where it does, a
[requirement](./requirements.md) is how you say so, and `plan` then shows "waits on" instead of a misleading answer.

When anything would change, `plan` ends with a one-line reminder that later steps were checked against the current
state.
