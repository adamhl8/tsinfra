# Roadmap

What tsinfra does next, what it plans to do, what's still undecided, what might come later, and what was ruled out. The
rest of the docs describe tsinfra as it is.

<!-- toc -->

- [Next](#next)
  - [Sending data to a command](#sending-data-to-a-command)
- [Planned](#planned)
  - [Running hosts in parallel](#running-hosts-in-parallel)
  - [Live progress](#live-progress)
  - [Reboot](#reboot)
  - [Tasks](#tasks)
  - [Diagnostic logs](#diagnostic-logs)
  - [The `shell` host option](#the-shell-host-option)
  - [Ordering between hosts](#ordering-between-hosts)
- [Follow-ups](#follow-ups)
- [Open questions](#open-questions)
  - [What `plan` output should look like](#what-plan-output-should-look-like)
  - [Interactive commands](#interactive-commands)
  - [Published, or personal](#published-or-personal)
  - [Integrations worth shipping](#integrations-worth-shipping)
  - [Fact helpers](#fact-helpers)
  - [Following symlinks in `file`](#following-symlinks-in-file)
  - [Files over 10 MB](#files-over-10-mb)
  - [`fsync` before the rename](#fsync-before-the-rename)
  - [Backups of replaced files](#backups-of-replaced-files)
  - [Steps side by side within a host](#steps-side-by-side-within-a-host)
- [Ideas](#ideas)
  - [Integration ideas](#integration-ideas)
  - [Integration notes](#integration-notes)
  - [Maybe later](#maybe-later)
  - [Removed resources](#removed-resources)
- [Rejected](#rejected)

<!-- tocstop -->

## Next

In the order they'll be built.

### Sending data to a command

A command's stdin is `/dev/null`, because the script itself travels on stdin (see
[Transport](./transport.md#commands-travel-on-stdin)). A script has no clean way to hand a command data from the control
machine. `exec` can carry the data inside a hand-written base64 heredoc, but that is the multi-line shell this design
avoids. The same gap stops a fix from writing a file, because `h.file` inside a fix is a step inside a step.

The answer is an `input` option, sent to the command's stdin. The [Homebrew](#homebrew) integration needs it first:

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

**Where it's taken.**

- **The `exec`, `read`, and `inspect` tools, and `h.read` and `h.inspect`,** next to `maskOutput`. A check needs it as
  much as a fix, like `inspect("diff - /etc/app.conf", { input: rendered })`.
- **Not `h.run`, or an `ensure`'s command strings.** A command string has no options of its own. `run` could take
  `input` as a step option, the way it takes `env`. An `ensure`'s `check` and `fix` share one options object, so one
  `input` couldn't say which command it's for. A check or fix function already reaches `input` through its tools.

**What it takes.** The same content as `file`: a string, bytes, or a `Blob` like `Bun.file(...)`, up to the same 10 MB,
for the same reason. A larger input, like an image for `docker load`, waits on [Files over 10 MB](#files-over-10-mb).

**How it travels.** The input travels the way `file` sends content, base64 in a quoted heredoc inside the script (see
[Transport](./transport.md#file-writes)). The tests already prove that under dash, busybox sh, macOS `/bin/sh`, and over
SSH. The heredoc decodes into a pipe to the script's command:

```sh
base64 -d <<'__TSINFRA_EOF__' |
<input as base64>
__TSINFRA_EOF__
{ brew bundle install --file=-
}
```

- **The heredoc's body comes before the command,** because a heredoc's body starts at the next newline, and a command
  can span lines. The shell never searches the command's text for the delimiter, so the command can hold any line.
- **The delimiter is fixed,** because base64 has no `_`, so the encoded input can't hold it.
- **Only the script's command is wrapped,** before the step's transport. The env prelude, the `sudo` function, and the
  outer `{ ... } </dev/null` then wrap it the way they wrap any command, so none of them change.
- **The pipeline's exit code is the command's,** so `exec` fails and `inspect` answers on the command's own exit code.
  A command that stops reading early ends `base64` with SIGPIPE, which nothing reports. A check by hand under macOS
  `/bin/sh`, started through Bun's spawn, found the bytes intact, the exit code passed through, and nothing on stderr.
- **The command reads a pipe,** not a file, so a command that seeks in its stdin can't use it (see the temp file below).
- **sudo never takes the input.** The tools and the read steps never run as root. A `sudo foo` the script writes in the
  command calls the `sudo` function, which uses `-n` or the askpass helper, never `-S`. So sudo never reads stdin, and
  the input reaches `foo`.

**What's recorded.** The record never holds the input, because it may be a secret, and it can be large. A command's
record keeps its text as the script wrote it, and the input's size. The report formats the size:

- **A step's commands** show it after the command at `-vv`, in angle brackets like `<content as base64>`:

  ```
  commands:
    $ brew bundle install --file=- <input: 1.2 kB>
  ```

- **A read or inspect** lists no commands, because its name is its command. So `input` joins its `options:` line at
  `-vv`, with its size at `-vvv`.

There's no `secret` flag. The size is all the record shows, and `maskOutput` already covers output that repeats the
input.

**Commands that only take a path.** Many take `-` or `/dev/stdin`. One that doesn't gets the data written to a temp file
first:

```ts
const tmp = await exec("mktemp")
await exec(`cat > '${tmp}'`, { input: dump })
await exec(`restore-tool --file '${tmp}'`)
```

A `tempFile` tool that removes its file when the step ends would be cleaner. But the tools have no hook for the end of a
step, and a temp file a check writes would be a write during `plan`. Add one, to the change tools only, when a port
needs a command that can't read stdin.

**A managed file is a separate choice.** Writing `~/.Brewfile` with `file` is still right when the file is useful on its
own, like for running `brew bundle --global` by hand. That's how to model the integration, not a workaround for missing
stdin.

**Implementation plan.** Each numbered piece is one commit. A piece can leave the feature unfinished, but it passes
lint and has its own tests. The lettered steps inside a piece are small enough to review one at a time, in order. They
don't need to pass lint on their own.

#### 1. Share `file`'s content reading

Nothing changes in behavior.

- **1a.** Move the 10 MB limit and `getContentBytes` from `handlers/file/resolved-content.ts` into
  `handlers/shared/content.ts`, exported as `readContentBytes`. It takes the text that names content that isn't a
  local file, like `the content given to 'file'`, in place of the fixed one. A `Blob` with a name still names its local
  file.
- **1b.** Move `FileContent`'s type, its schema, and `INVALID_CONTENT_REASON` from `handlers/file.ts` into the same
  module, as `Content` and `contentSchema`. `file.ts` keeps exporting `FileContent` as the same type, so the public
  name doesn't change.
- **1c.** Have `resolveContent` call `readContentBytes` and hash what it returns. The existing `file` tests cover it.

#### 2. Send input through the shell

- **2a.** Add `wrapCommandWithInput` to `core/transport/utils.ts`, next to `wrapCommand`, building the shape above.
  Move the `__TSINFRA_EOF__` delimiter there too, and have `file/write.ts` import it.
- **2b.** Add `input` (bytes) to `CommandOptions`, above `maskOutput`. With an input, `createShell` sends the wrapped
  command, and passes the command as the script wrote it as `recordedCmd`.
- **2c.** Add `inputSize` to `CommandRecord`, and have `createRecordingTransport` set it from the input's length. The
  options carry the input, not its size, because `core/transport/` imports nothing from `core/session/`, where `Bytes`
  lives.
- **2d.** Tests on the local transport, in a new `src/core/transport/__tests__/shell.test.ts`:
  - binary input arrives intact
  - the command's exit code comes back, through `exec` and `inspect`
  - a command that never reads its stdin, given 10 MB, succeeds with an empty stderr
  - a multi-line command, and one holding a line equal to the delimiter
  - a step transport's `env` reaches the command
  - the record holds the command as written and the size, never the input

#### 3. `input` on the tools and the read steps

- **3a.** Add `InputOptions` and `inputOptionsSchema` to `handlers/options/handler.ts`, above `MaskOptions`.
- **3b.** Add `ToolOptions`, extending `InputOptions` then `MaskOptions`, for `Exec` and `Inspect` in
  `handlers/tools.ts`, and validate it with both schemas merged, in that order. Export `InputOptions` and `ToolOptions`
  from `src/index.ts`.
- **3c.** In `execCommand` and `inspectCommand`, read the input with `readContentBytes`, named as
  `the input given to '<tool>'`, and pass the bytes to the shell.
- **3d.** Have `ReadOptions` and `InspectOptions` extend `InputOptions`. Their handlers already pass their options to
  `execCommand` and `inspectCommand`.
- **3e.** Tests on `@local`:
  - `h.read` and `h.inspect` with input, in `read.test.ts` and `inspect.test.ts`, and `inspect`'s non-zero exit with
    input
  - a check whose `read` takes input, and a fix whose `exec` does, in `ensure.test.ts`
  - a `Blob` from `Bun.file`
  - input over 10 MB, and a value of the wrong type, each failing the host with its message

#### 4. Report the input's size

- **4a.** Carry `inputSize` onto `StepCommand` in `toStepCommand` (`src/report/host-block/details/commands.ts`), and
  show it after the command in `formatCommands` as `<input: 1.2 kB>`, with the word in a constant.
- **4b.** For a read or inspect, build an `input` option from its one command's `inputSize` in `toOptionsDetails`, with
  the formatted size as its value.
- **4c.** Add a step command with input, and an `h.read` with input, to `report-preview.ts`.
- **4d.** Test in `src/__tests__/report.test.ts`: the size at `-vv` and not at `-v`, the read's `input` option at `-vv`
  and its size at `-vvv`, and the input's text nowhere in the output.

#### 5. Docker tests

- **5a.** `input-ssh.docker.ts` in `handlers/__tests__/`, on Alpine and Debian over SSH: 10 MB of binary input through
  `exec` and through `h.read` arrives intact, and a command that never reads its stdin succeeds with an empty stderr.
- **5b.** `input-sudo.docker.ts`: `sudo cat` with input gives back the input, for a host with passwordless sudo and for
  one with a password.

#### 6. Docs

- **6a.** Move this design into the docs:
  - `input` on the tools into [Steps](./steps.md#commands), with the brew example and commands that only take a path,
    and into [`read`](./steps.md#read) and [`inspect`](./steps.md#inspect)
  - how it travels into [Transport](./transport.md#commands-travel-on-stdin), after the `</dev/null` wrapper
  - the `<input: ...>` and the read's `input` option into the `-vv` and `-vvv` levels in [CLI](./cli.md)
- **6b.** Remove this section from the roadmap. Add the `tempFile` tool to [Maybe later](#maybe-later), mention `input`
  in [Files over 10 MB](#files-over-10-mb), and note in [Homebrew](#homebrew) that `brew bundle` takes `--file=-`.

## Planned

Decided, and wanted eventually, with no place in the order yet.

### Running hosts in parallel

Hosts run one at a time today. `--parallel <n>` runs up to `n` at once (default 8), with each host's output held until
it finishes, and the live progress area under the finished blocks. Steps within a host still run one at a time, in
order.

### Live progress

While hosts run, the output shows what tsinfra is doing, and each host's progress turns into its report when it
finishes:

- **A live line per running host,** with a spinner and the step it is on. The current step comes from the host's
  record, because a step's record is pushed when the step starts.
- **A permanent block per finished host.** When a host finishes, its live line goes away and its block prints above the
  live area, where it stays. The block is the same text `renderHostBlock` produces, so the live view and the report never
  disagree.
- **The summary** prints once every host has finished.

This uses [Ink](https://github.com/vadimdemedes/ink). Its `<Static>` component is this pattern exactly: what it
renders prints once and stays, while the rest of the output redraws below it. Ink also captures `console.log` from a
host script and prints it above the live area, so a script's own output can't garble the live lines. When stdout is not
a terminal, Ink prints the `<Static>` items and skips the live area, so CI and pipes get only the blocks and the summary.
That was checked under Bun with Ink 8.

[listr2](https://github.com/listr2/listr2) was the alternative. It is a task list with spinners and a concurrency limit,
and it is much smaller than Ink. It does not fit this design:

- **It controls the layout.** Finished tasks stay in their place in the list, with its own symbols and indentation. A
  block with diffs could only go in a task's output, formatted by its renderer.
- **It keeps list order, not finish order.** A host that finishes early would not print before the ones above it.
- **Its non-terminal output is its own.** Its fallback renderers print lines like task started and completed, not the
  report.
- **It does not capture a script's `console.log`,** which would write into the middle of its live lines.

Live progress comes with `--parallel`, because that is when hosts run at once, so progress matters. Until then the
blocks print directly as each host finishes. These details are still open:

- **What tells Ink to redraw.** A spinner redraws on a timer anyway, so the live lines could read the records on each
  tick. The other option is a callback from the session recorder when a step starts or finishes.
- **How much a live line shows.** It could be only the step's name, or also the command running inside it.
- **Long lines.** A failure's error can be wider than the terminal. The terminal wraps it, but the wrapped part loses
  its indent. `Bun.wrapAnsi` could wrap it to the terminal's width and keep the indent, but then the output depends on
  where it runs. Decide once real error output shows whether it's needed.
- **Testing.** `ink-testing-library` renders a component to text frames. The formatting functions keep their own tests
  either way, because they are plain functions.

### Reboot

The Incus host needs it after a kernel change. Until then, it reboots by hand, or with the
[reboot recipe](./recipes.md#a-reboot).

```ts
type RebootOptions = {
  after: ChangeStepResult<"file" | "link" | "dir" | "ensure" | "run" | "reboot">[] | "always" // the same as a run's
  timeout?: number // milliseconds to go down and come back, default 10 minutes
}
```

```ts
const kernel = await h.ensure("Install the HWE kernel", { ... })
await h.reboot({ after: [kernel] })
```

`h.reboot(options)` reboots the host, waits for it to come back, and carries on with the script. Running `reboot` with
`exec` would drop the connection, so the command would look failed, and nothing would wait for the host. A reboot is a
follow-up to a change, not state a check can read, so it works like a [`run`](./steps.md#run):

- **`after` decides when.** It reboots when a step it follows changed, or on every pass with `"always"`. In `plan` it
  never reboots, and shows as a `>` line, so later steps are checked against the host as it is, like any step after a
  change.
- **How it works.** It reads the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl -n kern.boottime` on
  macOS), starts `sudo reboot` in the background so the command returns cleanly, drops the ControlMaster socket, and
  polls until the host answers. Then it reads the boot id again. An unchanged boot id fails the step with
  `the host didn't reboot`, so a host that never went down doesn't count, the same check Ansible's `reboot` makes.
- **One `timeout`** covers going down and coming back. Ansible splits it in two, which mostly helps it word its errors.
- **It escalates like any command,** through the `sudo` function, so the host declares `sudo` on `host()` (see
  [Transport](./transport.md#sudo)).
- **`@local` refuses it,** with `can't reboot @local, because it's the machine tsinfra runs on`.
- **It's a top-level step.** A fix that installs a kernel doesn't reboot by itself, and the script follows that step
  with `h.reboot`.
- **It follows the same [open change](./steps.md#when-an-apply-doesnt-finish) rules as a run.** It opens its change
  before it reboots, records itself on the open changes it follows, and triggers from one that doesn't list it, as
  `ranFromOpenChanges`. One that didn't trigger, but whose change is still open, is `resume`.
- **It returns a `ChangeStepResult<"reboot">`,** so a run can follow it. `"reboot"` joins `ChangeStepKind`, and a
  run's `after`. Like a run's, it can't be needed, because nothing about the host's state says a reboot happened.

### Tasks

A host can have named tasks besides its main function, for work you run on demand, like updates. Configuring a host and
updating it use the same steps, but an update shouldn't happen every time the configuration changes:

```ts
const update = task("update", async (h) => {
  await h.ensure("Upgrade packages", {
    want: [],
    check: "sudo apt-get update && apt list --upgradable | tail -n +2",
    fix: "sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
  })
})

export default host({ name: "sonarr", target: "sonarr.lan", sudo: true, tasks: [update] }, configure)
```

```sh
tsinfra plan sonarr                # the main function
tsinfra plan sonarr --task update  # only the update task
tsinfra plan --task update         # every host that has an update task, and no others
```

- **A task is an ordinary host function,** with the same `h`, steps, `plan`, `apply`, session, and sudo prompt. With
  `want: []`, `plan --task update` lists what would upgrade on every host.
- **`task(name, fn)` mirrors `host(config, fn)`,** and `host()` registers its tasks explicitly with `tasks`, so a task
  only belongs to the hosts that list it. A task exported from a shared module doesn't register itself anywhere.
- **Define a task above the `host()` call,** because `host()` reads `tasks` straight away, and a `const` can't be read
  before its line.
- **Task names are unique within a host.**
- **It isn't tags.** Tags pick steps inside one script. A task is a separate function, so each one still reads top to
  bottom.

### Diagnostic logs

Logs are separate from the report. They are for working out what tsinfra itself did, like which SSH command it ran, how
long a connection took, or why it failed. They use [LogTape](https://logtape.org) and go to stderr, so stdout stays the
report.

- **LogTape** has no dependencies and supports Bun. It stays silent until the application configures it, which matters
  because host scripts import tsinfra as a library. It ships a JSON Lines formatter, and `@logtape/pretty` for readable
  terminal output.
- **`@optique/logtape`** adds the logging options to the existing Optique parser: `--log-level` and `--log-output`. It
  can also add a `-v`/`-vv` form, which tsinfra leaves out, because `-v` already sets how much the report shows (see
  [CLI](./cli.md#output)).

LogTape is its own feature, added on its own.

### The `shell` host option

Decided on 2026-11-11, and skipped from the SSH pieces because nothing needs it yet. It's for a tool whose PATH only a
login shell loads (see [Login shells](./transport.md#login-shells)).

```ts
export default host({ name: "caddy", target: "caddy.lan", shell: ["bash", "-l", "-s"] }, async (h) => { ... })
```

The host option `shell` replaces the whole command that starts the host's shell, as an array of words. The default is
`["sh", "-s"]`. The control machine's own commands, like `ssh -G`, keep `sh -s`.

- **The option is the whole command, `-s` included.** tsinfra adds no flag to it, because it can't know how another
  shell reads its script. The one requirement is that the shell reads its script from stdin.
- **Each word reaches the shell as written.** Locally, tsinfra runs the array as the process's arguments. Over SSH, ssh
  joins its arguments into one string, and the user's login shell parses it, so tsinfra quotes each word with
  `quoteShellArg` first. A single string would mean two things. Split locally, `bash -c 'x'` gives bash the quotes as
  part of its script. Over SSH, the login shell removes them.
- **`sudo: true` runs the same shell,** as `sudo <shell> <<'<delimiter>'`, with each word quoted. Under sudo, `-l`
  loads root's profile, not the user's, because sudo sets `HOME` to root's.
- **tsinfra checks nothing about the shell.** Picking one that works is the user's job. The commands tsinfra writes,
  like the `{ ... } </dev/null` wrapper, the `sudo` function, and `file`'s scripts, are POSIX sh. So the shell must be
  POSIX compatible, and fish is not. A shell that can't run them fails preparation's first command.
- **Its tests:** a local `env` word that sets a variable the script reads, and over SSH a `sh -l` that sees an export
  from the SSH user's `.profile`.

A login shell has two pitfalls, which the user docs should warn about:

- **Anything the profile prints lands in every command's stdout.** That breaks preparation's home directory read and
  `file`'s details, so a profile that prints can't be used.
- **`bash -l` may not load PATH set in `.bashrc`.** A login bash reads `.profile`, which on Debian sources `.bashrc`.
  Debian's `.bashrc` stops early in a non-interactive shell, so a PATH line at its end never runs. Move the line into
  `.profile`. Adding `-i` loads `.bashrc`, but an interactive bash reading a pipe writes prompts and job-control
  warnings to stderr, which lands on the record.

A `path` option may fit that case better (see [Maybe later](#maybe-later)).

### Ordering between hosts

A tentative design, to build after `--parallel` and most of the rest of this section. Until then, the Incus host and its
containers run as separate commands.

One host can rely on another. The Incus host has to create a container before the container's own script can run, and a
database host may need to be up before an app host. A host declares this with `needs`, which takes the host scripts it
imports:

```ts
import incus from "./incus.ts"

export default host({ name: "sonarr", target: "sonarr.lan", needs: [incus] }, configure)
```

- **It's named `needs`, not `after`.** On a `run`, `after` means "only if those changed", but `sonarr` runs whether or
  not Incus changed. A step's [`needs`](./needs.md) already means "depends on this, and waits in `plan`".
- **It takes imports, not names,** because a step's `needs` takes values too, and an editor catches typos and follows
  renames. An import cycle fails when the scripts load, with a confusing error.
- **Hosts run after what they need.** Each host starts once the hosts it needs have finished, which also works with
  `--parallel`.
- **Preparing has to change.** Today every host is prepared before any script runs, and a container that doesn't exist
  yet would fail there. A host with `needs` that can't be prepared gets one more try after the hosts it needs finish,
  and only then fails. A sudo prompt for that host moves to that point too.
- **A new container may not be ready straight away,** so the Incus script should wait for it as its last step.
- **In `plan`, a host that can't be prepared shows as waiting** when a host it needs has changes, like `? needs 'incus'`.
- **A host whose needed host failed is skipped,** and the run exits 1.
- **Picking hosts doesn't add any.** `tsinfra apply sonarr` runs only `sonarr`, because you named it. Order only applies
  among the hosts being run.

Still undecided: whether a host that can be prepared plans normally while a host it needs has changes. The leaning is
yes, because otherwise every container's plan disappears whenever Incus has any change. The stricter rule matches a
step's `needs`, and waits whenever a needed host has changes.

Other approaches, and why they lost:

- **Order of the command line,** like `tsinfra apply incus sonarr --parallel 1`. It needs no new concept, but you'd have
  to remember it every time, and a plain `tsinfra apply` would have no order.
- **Stages or numbered folders.** The whole order is in one place, but a stage also waits on hosts it doesn't depend on.
- **The Incus host declaring its containers.** Adding a container would mean editing the Incus file.
- **Batches and serial runs,** like Ansible's `serial` and `order` and Salt's batch mode. These are for rolling a change
  through a fleet, which isn't the homelab's problem.
- **An orchestration layer,** like Salt's orchestrate runner, which runs states on one group of hosts, then another.
  That's a second language for the order of hosts.

## Follow-ups

Fixes and finishing work for what's already built.

- **Stop remote commands on Ctrl-C.** Without a terminal, Ctrl-C ends the local `ssh`, but the command on the host
  keeps running. nixos-rebuild runs a remote `pkill -SIGINT` when it's interrupted. tsinfra needs the same, with the
  process to stop known, and the run's connections still closed.
- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after
  that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the
  wrong step. `callStep` already builds a fresh set of tools for each step. What's left is to bind them to the step's
  record, and fail the host through `callOrFail` when that step is no longer the running one. Do not throw in
  `recordCommands`, because only `session.ts` throws, and a throw there would skip recording the failure in
  `callOrFail`.
- **Run the Docker tests in CI.** `bask test-docker` stays out of `bask lint`, because it needs Docker and downloads
  images and packages, so nothing runs it automatically yet.
- **Check SELinux labels on a VM.** `file`'s `chcon` and `restorecon` are untested on real labels, because containers
  run with SELinux off.
- **The user docs.** When the full docs get written, start from [Recipes](./recipes.md), and add the comparison with
  other config tools from the [design notes](./README.md#compared-with-other-tools), led by tsinfra's strengths. Warn
  about a login shell's pitfalls once [the `shell` option](#the-shell-host-option) exists.

## Open questions

What still needs an answer. Most are best settled by porting real hosts first.

### What `plan` output should look like

[CLI](./cli.md#output) has a first guess. The evidence so far is `~/homelab/justfile`, whose `plan` recipe filters
pyinfra's JSON down to just the names of pending changes. That suggests the default should be terse, with diffs. Settle
it by running `plan` on the ported Mac and reacting to what it shows. How the report is built is settled (see
[CLI](./cli.md#how-the-report-is-built)), so this is only about what it shows.

### Interactive commands

Some commands need a person at the keyboard, like an installer that asks questions. Commands normally run with their
script on stdin and their output captured, so nothing can answer a prompt.

Two ways to allow it:

- **Inherit the terminal.** Connect the command to the CLI's own terminal (`stdio: "inherit"` locally, `ssh -t`
  remotely). The user answers prompts directly, and tsinfra sees none of the output.
- **A pseudo-terminal.** `Bun.spawn`'s `terminal` option attaches a PTY, so tsinfra sits between the command and the
  user. It can show and record the output, or answer a prompt itself. A sudo password doesn't need this, because
  askpass covers it (see [Transport](./transport.md#sudo)).

Either way it is a separate mode, not how commands normally run. A PTY merges stdout and stderr and would echo a script
sent on stdin, so the command would travel as an argument instead. An interactive command also needs the terminal to
itself, which conflicts with hosts running in parallel and with `BatchMode`. Settle it when a real host needs one.

### Published, or personal

The package is set up for npm (`exports`, `bin`, publint, release-it). If tsinfra stays personal tooling for
`~/homelab`, the packaging work is optional. If it is published, it stays.

### Integrations worth shipping

An integration is a set of functions that take `h` and call steps to set up one specific program, service, or piece
of config, like apt packages or systemd units. The candidates are in [Integration ideas](#integration-ideas). Start
each as a function in `~/homelab/lib`, and move one into tsinfra only once two hosts use it the same way.

An integration configures the host itself: its packages, services, files, users, and settings. It doesn't manage
objects inside an app, like a database's users, or resources behind an API, like DNS records, because those belong to
the app's own tooling or to tools like Terraform. And no integration installs and runs one app for you, like a Postgres
or Tailscale module. A script does that with the general integrations.

Each family of shipped integrations gets its own export path, like `tsinfra/apt` or `tsinfra/systemd`, so a script imports
only the families it uses. The root, `tsinfra`, stays the core API: `host`, and every type a script annotates with. The
file mode constants stay in the root too, because they're values for a core step's option, and their types have to be
there for `FileOptions`. A subpath is an entry file like `src/facts.ts`, an `exports` entry in `package.json` with
`types` and `import` like the root's, and whatever the build and knip need to treat it as an entry.

### Fact helpers

A fact is something read from the host that no step changes, like the CPU architecture, which is what a script may
branch on (see [Steps](./steps.md#choosing-a-method)). Today a script reads one with `h.read`. A few helpers would
normalize the common ones. A fact helper only reads something no step can change:

| Helper         | Reads             | Returns                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| `arch(h)`      | `uname -m`        | Node's `process.arch` names, like `"x64"` and `"arm64"`                           |
| `platform(h)`  | `uname -s`        | Node's `process.platform` names, like `"linux"` and `"darwin"`                    |
| `osRelease(h)` | `/etc/os-release` | `{ id, idLike, versionId, versionCodename, prettyName }`, or `undefined` on macOS |

```ts
import { arch } from "tsinfra/facts"

const cpu = await arch(h)
await h.ensure("Install the arm build", { want: true, check: "...", fix: `... ${cpu} ...` })
```

- **Each takes `h` and runs at the top level only.** A helper is an ordinary `h.read` with the
  normalizing added, so it shows as its own `·` line in `--verbose`, the same as a helper a script writes itself. A step
  uses the fact through the closure, as above. Calling a helper inside a step's function fails the host with
  `'read' can't run while ensure step 'X' is running`, like any other call on `h` there.
- **There's no hidden way to run commands.** A helper that reached the shell around `h` would skip the session recorder
  and the failed-host check, and would follow rules a script's own helpers can't.
- **The value is in the normalizing.** `uname -m` prints `x86_64` or `aarch64` on Linux and `arm64` on macOS, and
  download URLs want `amd64` or `x64`. Node's names give the host the same vocabulary as the control machine. If a step
  ever needs the normalizing inside its function, the pure part can be exported too, like
  `toNodeArch(await read("uname -m"))`.
- **`os-release` covers every current Linux** through one standard file, with no per-distribution cases.
- **No fact system.** pyinfra has fact classes with a command and a parser, `host.get_fact`, a cache, and defaults for a
  missing command. tsinfra leaves those out, because a fact read once at the top of a script is just a `const`. A
  missing command is already an answer through `inspect`.
- **No facts about state a step manages,** like whether a file exists, a package is installed, or a command is on the
  `PATH`. Those belong in a step's check, where `plan` reads them at the right time. A `hasCommand` helper would invite
  the wrong shape from [Steps](./steps.md#choosing-a-method), an `inspect`, an `if`, and a `run`, instead of an
  `ensure` with `check: "command -v docker"`. A prerequisite nothing in the script installs is checked with
  `h.inspect` and a `throw` (see [Needs](./needs.md#a-prerequisite-nothing-in-the-script-installs)). pyinfra's docs warn about the same thing: "Only use
  immutable facts in deploy code (installed OS, Arch, etc)".
- **Container detection is left out** until a port needs it, because it differs across Docker, LXC, and systemd.

Build them once the Mac and container ports show which facts the scripts actually branch on.

### Following symlinks in `file`

`file` refuses a path that is a symlink, so it never replaces a link with a regular file, or writes somewhere the
script didn't name (see [Steps](./steps.md#file)). Making a link is [`link`](./steps.md#link)'s job. This question is
only whether `file` should follow an existing link and write to its target instead. The tools split on
this. Chef writes through the link to its target, and Ansible makes it an option. Following links would mean the file details script
resolves the real path first and reports it, and the write goes there. Decide when a port needs to manage a file that
is reached through a symlink.

### Files over 10 MB

`file` sends content in a base64 heredoc inside the write script, which the shell holds in memory before it runs, and
base64 adds a third. That is fine for config files, so content over 10 MB is refused (see [Steps](./steps.md#file)).
A `Blob` from `Bun.file` already offers `stream()`, so a streaming path could read the local file in chunks too.
Every agentless tool uses SFTP or scp instead, which streams. A streaming path for large files would upload with `scp`
to a temp file in the destination's directory as the SSH user, which works without `sudo`. With `sudo`, it needs a
user-writable place and a root `mv`, the two-hop step the heredoc avoids. Add it when a port needs a large file.

### `fsync` before the rename

The write doesn't `fsync` the temp file before the rename (see [Transport](./transport.md#file-writes)). After a crash
at the wrong moment, the file could be in place but empty. Puppet and Salt `fsync`, and Ansible and Chef don't.
`sync "$tmp"` would add it, but busybox ignores the argument and flushes everything. Add it if a host turns out to lose
power or crash often enough to matter.

### Backups of replaced files

Chef, Puppet, Ansible, and Salt can each keep a copy of the file they replace. tsinfra doesn't, because the script in
version control is the record of what a file should be, and `plan` shows the diff before anything changes. Revisit if a
port manages files that something else on the host also edits.

### Steps side by side within a host

Steps on one host run one at a time, and a step that starts while another is running fails the host (see
[Steps](./steps.md#commands)). That is how the session knows which step a command belongs to, with one variable for the
current step. Running steps side by side is not worth supporting yet:

- **Order usually matters.** You install before you configure, and the plan reads the same way on every run.
- **The slow steps tend to collide.** Two `apt-get install` steps fight over the dpkg lock.
- **Most of the waiting is across hosts,** which `--parallel` will cover.

Commands inside one step can already run at once, with `Promise.all` over `exec` in a fix. If a host ever needs steps
side by side, `AsyncLocalStorage` from `node:async_hooks` can track the current step for each async chain instead of
one variable for the host.

## Ideas

Features other tools have that could fit tsinfra, from a survey of pyinfra, Ansible, Salt, Chef, Puppet and Bolt,
cdist, Rex, Nix with home-manager and nix-darwin, mgmt, chezmoi, dotbot, yadm, Comtrya, Fabric, Pulumi, and Terraform
with OpenTofu, in November 2026. None is decided.

### Integration ideas

Integrations that might ship (see [Integrations worth shipping](#integrations-worth-shipping) for what one is). Each is
weighed on its own, and none is decided. One that
ships follows the rule, scope, and packaging in [Integrations worth shipping](#integrations-worth-shipping). An idea with notes
so far links to them in [Integration notes](#integration-notes). "Maybe" marks the ones less likely to be worth it. Other tools'
catalogs suggested most of these (pyinfra's operations, Ansible's modules, Salt's states, Chef's resources, cdist's
types, nix-darwin, and home-manager).

**Packages**

- apt packages
- apt repos and keys, as a deb822 `.sources` file with its keyring
- [Homebrew](#homebrew), a Brewfile and `brew bundle`, with cleanup
- Mac App Store apps, with `mas`
- local package files: a `.deb`, or a macOS `.pkg` or `.dmg`
- [a portable package integration](#portable-integrations), which picks apt, apk, or brew for the host
- npm, pnpm, and Bun global packages
- pip, pipx, and uv packages and tools
- maybe: cargo, `go install`, and gem
- maybe: flatpak and snap
- maybe: version managers, like mise, asdf, or pyenv
- maybe: a GitHub release binary, picked for the host's OS and CPU
- maybe: a whole-system upgrade, which may be just an `ensure`
- maybe: unattended-upgrades, which may be just an `ensure`

**Services**

- systemd unit, with reload
- systemd timers
- systemd user units
- [a portable service integration](#portable-integrations), which picks systemd, OpenRC, or launchd for the host
- maybe: systemd drop-ins, an `override.conf` that changes a few settings of a unit a package shipped
- maybe: launchd agents and daemons
- maybe: `brew services`, Homebrew's way to keep a formula's daemon running

**Files**

- `put_files`, a map of local files to their destinations
- [A managed block in a file](#lines-in-a-file)
- [A single line in a file](#lines-in-a-file)
- unarchive
- maybe: [a remote file](#remote-file), downloaded and checked against a checksum
- maybe: a directory sync, like rsync
- maybe: one setting under one section of an INI file, like `smb.conf`
- maybe: one `key=value` line in a flat file, like `/etc/default/grub`
- maybe: a file built from fragments that several steps add to

**Users and access**

- users and groups, with group membership
- SSH: `authorized_keys`, `known_hosts`, and `sshd_config`
- sudoers drop-ins

**Containers and storage**

- Docker containers
- Docker Compose project
- [Docker images kept on the newest version](#docker-images)
- LXD or LXC
- ZFS

**The user's setup**

- git config
- a shell setup: rc lines and `PATH` entries
- per-program config, like home-manager's `programs.*` for git, ssh, or a prompt
- [macOS `defaults` keys](#macos-defaults)
- maybe: default apps and file associations, with `duti` on macOS
- maybe: fonts

**System**

- maybe: [system settings](#system-settings) in one integration: hostname, timezone, locale, `/etc/hosts`, sysctl, kernel
  modules, mounts, swap, cron, logrotate, motd, and macOS power settings
- maybe: a firewall, like ufw
- maybe: wait for a port or URL

**Other**

- [A run-once marker](#run-once-marker)
- [A 1Password reader](#1password-reader)
- [Facts: CPU architecture, platform, and OS release](#fact-helpers)
- [Full-set cleanup, which removes what isn't declared](#removed-resources)

**Left out:**

- **Editing JSON or replacing by regex** belongs in TypeScript. A script reads the file, changes it, and writes it
  with `file`.
- **Databases' users and tables, DNS records, and TLS certificates** are objects inside an app or behind an API (see
  [Integrations worth shipping](#integrations-worth-shipping)).
- **Validating a file before it's written** is already `file`'s `validate` option.

### Integration notes

What's known so far about the ideas in [Integration ideas](#integration-ideas).

#### Homebrew

`tsinfra/brew`: a Brewfile written with `file`, an `ensure` on `brew bundle check --no-upgrade` with
`HOMEBREW_NO_AUTO_UPDATE` set, and nix-darwin's cleanup modes. `plan` computes the extras itself, because
`brew bundle cleanup` prompts.

#### Portable integrations

One integration over several tools, picking the one the host has, like pyinfra's `server.packages` and `server.service` and
Ansible's `package` and `service`. A package integration picks apt, apk, or brew, and a service integration picks systemd,
OpenRC, or launchd. Ansible's docs say its `package` covers only "the minimum intersection" of the tools' options, so
a script that needs one tool's options uses that tool's integration.

#### Remote file

Like pyinfra's `files.download`, Ansible's `get_url`, and Chef's `remote_file`: fetch a URL on the host and check it
against a checksum. It may be an `ensure` with a recipe, or an option on `file`, rather than an integration.

#### System settings

One integration that takes an object of the settings to set, and sets only the keys given, like hostname, timezone, locale,
`/etc/hosts` entries, sysctl, kernel modules, mounts, swap, cron, logrotate, motd, and macOS power settings. Other
tools have a step per setting (pyinfra's `server.hostname`, `server.sysctl`, and so on).

#### Docker images

`tsinfra/docker`: container integrations, starting with the `want: []` `ensure` that keeps running containers on the newest
images (see [Recipes](./recipes.md#running-the-latest-container-images)), if the Docker container ports repeat it.

#### Lines in a file

`tsinfra/files`: a managed block between marker lines, like Ansible's `blockinfile`, Salt's `file.blockreplace`, and
pyinfra's `files.block`. Maybe a single-line function too, though Ansible itself warns against overusing `lineinfile`, and
pyinfra's unanchored `files.line` match also catches `#foo` when you meant `foo`. Puppet's `file_line` has the cleanest
options: `line`, `match`, `after`, and `multiple`.

#### macOS defaults

`tsinfra/macos`: each `defaults` key as an `ensure`, with `defaults read` as the check and `defaults write` as the fix,
and a run that restarts Dock or Finder after. `defaults read` prints booleans as `1` and `0`. Like nix-darwin, a removed
key stays as it was.

#### Run-once marker

Like chezmoi's `run_once_`: save a hash of the command in the host's [saved state](./transport.md#saved-state), and
check for it.

#### 1Password reader

Like chezmoi's `onepasswordRead`: run `op read` with Bun `$` on the control machine and pass the value to `file` with
`secret`. Every `plan` has to read the secret to compare it, so every plan prompts.

### Maybe later

Opt-in features with no real case yet:

- **`--json`** writes the report as one JSON document on stdout instead of the text blocks, for scripts and CI. It
  would serialize each host's record (see [CLI](./cli.md#what-a-host-records)), with each error as its message chain,
  and a version field so the shape can change later. Terraform's rule for that field works: readers ignore fields they
  don't know, and refuse a major version they don't support. No library is needed. Diagnostic logs stay on stderr
  either way, so stdout is only the document. Add it when something needs to read the output.
- **A shell-quoting helper,** exporting the `quoteShellArg` tsinfra already uses for its own commands. A list of values
  whose shape isn't fully trusted could then go into a command's text safely, like
  `` `apt-get install -y ${missing.map(quoteShellArg).join(" ")}` ``, which `env` doesn't handle well, because a
  variable holds one string. It adds to the public API, so add it when a script needs it.
- **`tsinfra exec <host> -- <cmd>`** runs an ad-hoc command on a host's target without its script, like
  `pyinfra INVENTORY exec`.
- **`--fail-fast`** stops starting new hosts once one fails, like Ansible's `any_errors_fatal` and Salt's `failhard`.
  With `--parallel 1`, it works as a canary rollout.
- **`apply --confirm`** plans, prints the report, asks, then applies, like Terraform's `apply` prompt.
- **Retries on a fix,** like Ansible's `until`, Salt's `retry`, Chef's `retries`, and pyinfra's `_retries`. A `retry()`
  helper inside the fix may be enough.
- **`backup` on `link`,** for the first dotfiles run, where real files sit where the links go. home-manager's `-b`
  moves them aside and aborts if the backup already exists. If backups come back for `file`, Puppet's same-folder copy
  with an extension is the lightest model (see [Backups](#backups-of-replaced-files)).
- **`env` on a tool call,** for a value that only exists inside a step's function, like a container ID from one
  `exec`, which goes into the next command's string today. Add it if a port needs one.
- **An argument list as a command,** like `exec(["tar", "-xzf", name])`, rendered by quoting each element with
  `quoteShellArg`. It's safe for any value, with no variable to name, like Ansible's `command` module and Chef's array
  form of `execute`. Pipes, redirects, and `$VAR` don't fit it, so it would sit beside command strings, not replace
  them. Add it if the ports show many commands built from values, where `env` feels heavy.
- **A programmatic `plan()` and `apply()`** that return host records, like Pulumi's Automation API.
- **A container transport,** like pyinfra's `@docker/<name>` connector, with the same `@` syntax as `@local`:
  `@incus/<name>` through the local `incus` client and a configured remote, and `@docker/<name>` through
  `docker exec -i`. Every command already goes to `sh -s` on stdin, so only the command that starts the shell changes.
  Commands run as root, so `~/` means `/root`. Incus containers can just be reached over SSH, and Docker app containers
  are usually replaced rather than configured, so neither needs it yet. Deferred.
- **Run something before a change, only when the change will happen,** like Salt's `prereq`, which drains a load
  balancer before a deploy, and Chef's `notifies ... :before`. The likely shape is a `before` option on `file`, and maybe
  `link`, taking a command or a function given `exec`, like a fix. It runs only in `apply`, only when the comparison
  shows a change, and right before the write, and `plan` lists it under the change. The case is an app that writes its
  config when it stops, like qBittorrent: stop it in `before`, and start it with a `run` whose `after` names the
  `file`. A `run` with `after` already covers the half after the change, and an `ensure`'s fix can start with the
  stop, so neither needs a hook.
- **Reset the connection,** like Ansible's `meta: reset_connection`. A user added to a group, like `incus-admin` or
  `docker`, doesn't get it in commands that reuse the ControlMaster connection that logged in before the change. A
  rerun within `ControlPersist` reuses it too. Dropping the master makes the next command log in again. `h.reboot`
  will drop it too, so the two can share that code. Until then, use `sudo`, or `sg <group> -c '...'`.
- **Log in with an SSH password,** like Ansible's `--ask-pass`. Today `BatchMode=yes` stops ssh from prompting, so a
  host that only takes a password fails in preparation with ssh's `Permission denied (publickey,password)`. ssh can ask a
  helper instead of the terminal, with `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4 and later), the same
  way sudo's askpass works. The helper runs on the control machine and prints a variable, so it holds no secret. Only
  the connection that opens the ControlMaster logs in, so a host needs the password once per run. It fits the sudo
  prompt's flow: `buildHostDetails` stops a host whose `Permission denied` lists `password`, then `finishHostDetails`
  prompts for it, opens the connection, and goes straight on to sudo, prompting for that too if needed. Each host's
  prompts come together, one host at a time. A key's passphrase would come through the same helper, and ssh's prompt
  text tells the two apart.
- **A `path` host option,** a list of directories prepended to `PATH` in every command, like pyinfra's `_env` and
  Ansible's `environment`, but only for PATH. It covers the case the `shell` option is for, a tool installed outside
  the default PATH, like Go's. It has none of a login shell's pitfalls (see [The `shell` host option](#the-shell-host-option)).
  - **How it works:** a transport wrapper, like the one that adds the `sudo` function, starts each script with
    `PATH=<entries>:"$PATH"` and `export PATH`. It wraps each command after the recorder has seen it, so the record shows the script as written.
  - **Under sudo:** sudo resets PATH to its `secure_path`, so a `sudo: true` step gets the same line inside its nested
    shell. A `sudo` command inside a script still gets sudo's own PATH.
  - **Entries:** an entry must be absolute or start with `~/`. A `~/` entry resolves against the home directory that
    preparation reads, like `file`'s paths. An entry can't hold `:`, because PATH splits on it.
  - **Why not `env`:** a step's `env` sets literal values for that one step, so it can't extend `PATH`. `path` would
    prepend to it in every command on the host.
- **A manual step,** for work no command can do: pressing a pairing button, a login URL from `tailscale up`, an App
  Store sign-in for `mas`, or a macOS permission like Full Disk Access. It's shaped like `ensure` with instructions in
  place of a fix, like `h.manual(name, { want, check, instructions })`. `plan` shows the instructions under `~ change`.
  `apply` prints them, waits for Enter, then checks again. A step with a check stops prompting once the work is done,
  which an unconditional pause like Ansible's `pause` can't do. An unconditional pause also makes a second `apply`
  stop again, and hangs an unattended run. Today an `ensure` whose fix fails with the instructions does the same job
  with a rerun, because every earlier step is already right.
- **A prompt step that returns a value,** a `read` answered by the user, like `h.prompt(name, { secret: true })`, for
  values that only exist at run time, like a Plex claim token or a 2FA code. The script decides when to ask, like only
  when a `read` shows the server isn't claimed yet. It prompts in `plan` too, so later steps can show a real diff.
  Ansible's `pause` saves its answer the same way.

  Both steps reuse the sudo prompt's pieces: `readHiddenLine`, Ctrl-D to skip the host, Ctrl-C to cancel the run, and
  failing the host without a TTY. A host script can't prompt by itself, because tsinfra owns the terminal once hosts
  run in parallel. The cost is that these prompts come mid-run, not in preparation, so prompts from parallel hosts take
  turns and the live progress area pauses while one is open.

### Removed resources

The lowest priority here, and probably never built. A step the script stops managing leaves its file, link, or package
on the host, because there is no record of resources (see [No record of resources](./README.md#no-record-of-resources)). tsinfra doesn't track this, and
the automatic approaches are in [Rejected](#rejected). What's left:

- **Turn a step into its removal instead of deleting it.** This is the recommended pattern, and it needs no new feature
  (see [Recipes](./recipes.md#turn-a-step-into-its-removal-instead-of-deleting-it)). A step deleted without this leaves
  what it made on the host.
- **A manifest of `file` and `link` paths on the host,** kept in the host's [saved state](./transport.md#saved-state), where `plan` only
  warns about paths in it that the script no longer manages. The machine stays the only source of truth. A path is the
  one thing that identifies a step across edits, so this list can be accurate. It wouldn't cover anything done through
  `ensure`. Add it only if a port shows that forgotten files are a real problem.
- **A full set whose contents can be listed.** An integration can find the extras in a set the script declares completely.
  nix-darwin's Homebrew `cleanup` is `none`, `check`, `uninstall`, or `zap`, and Salt's `file.directory` with
  `clean: True` and chezmoi's `exact_` folders delete every entry the run didn't declare. A managed folder's `plan` must
  list every file it would delete.

## Rejected

Recorded so the survey doesn't need redoing:

- **A run that reports nothing changed,** like Ansible's `changed_when` and Salt's `stateful` scripts, as a run function
  returning `{ changed: false }`. Its case, pulling images and recreating containers only when one is new, is an
  `ensure` on "the running containers are on the newest images", with a read-only check and `want: []` (see
  [Recipes](./recipes.md#running-the-latest-container-images)). The run version only made sense because it let the pull
  sit where a read-only check belongs, and its `plan` showed a change every time.

- **An absent form,** like Terraform's `removed`, chezmoi's `remove_`, and mgmt's `state: absent`, as an `h.remove(path)`
  step. Deleting a specific path is rare, and an `ensure` that the path is gone already says it and reads well. A new
  step kind would be a concept with no real case.

- **Removing what a deleted step did, automatically.** Terraform can because each resource's delete logic lives in its
  provider, which outlives the resource block. `ensure` and `run` run arbitrary commands, so tsinfra can't know how to
  undo them. Deleting a step is also ambiguous, because it can mean "undo this" or "stop managing this". Stopping
  managing `/etc/ssh/sshd_config` must not delete it, because tsinfra configures machines that already exist.

- **A saved record of steps, reporting the ones no longer in the script.** Nothing identifies a step across edits. A
  renamed step looks removed, and a step repurposed under the same name never reports what its old version did. A hash
  of its commands fails the same way, because a harmless typo fix changes the hash. Whether an edit keeps the step's
  purpose is known only to its author, and a declared ID would only fix renames. A list that misses things can't show a
  host is clean.

- **An `undo` attached to a step, run by a flag.** The step stays in the script, so the next `apply` puts the thing back.
  `plan` never shows the removal, a host that was down misses it, and the undo goes stale because nothing runs it. Saving
  it on the host, like the removal scripts `dpkg` keeps, can't save a function.

- **Pruning symlinks that point into the repo,** like a `pruneLinks(dir, repo)` step, dotbot's `clean`, and
  home-manager's generations. A symlink into the repo is a hint, not proof, because anything can create one.

- **Tags, targeting, and `--start-at-task`.** Tags are a non-goal, and idempotent steps make starting partway pointless.
- **`block`/`rescue`, `ignore_errors`, and continuing past a failure.** A failed host stays failed, and `inspect`
  handles an exit that isn't an error.
- **State-file features:** saved plans, `moved` blocks, refresh-only, generations, and rollback. Rollback is a git revert
  and an `apply`.
- **Closing [open changes](./steps.md#when-an-apply-doesnt-finish) by hand,** like a flag that deletes them without firing their runs. Open
  changes exist so nobody has to fix a host by hand. A clean apply closes them anyway, at the cost of a run that's safe
  to repeat.
- **Guards like `only_if`, `not_if`, `creates`, and `unless`.** `ensure`'s check covers them, and Chef's own docs show
  guards make why-run inaccurate.
- **Delegation and `local_action`.** The script already runs on the control machine.
- **Plugin systems for output.** JSON output covers what a reader needs.
- **Fact caching and fact systems.** See [Fact helpers](#fact-helpers).
- **Vaults and encrypted files in the repo.** TypeScript can call sops or a password manager directly.
- **Reading every step's state before any fix,** like cdist's stages and pyinfra's prepare phase. It decides on state
  that's stale by the time the fix runs.
- **Delayed, deduplicated notifications.** A run after both steps with `after: [a, b]` already fires once.
- **Async tasks.** They have no check mode, and SSH keepalives cover long commands.
- **Real-time watching,** like mgmt. A daemon is the full config tool tsinfra isn't.
- **Second languages for plans,** like Bolt's YAML plans and cdist's file-per-parameter types.
