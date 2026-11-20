# Roadmap

What tsinfra does next, what it plans to do, what's still undecided, what might come later, and what was ruled out. The rest of the docs describe tsinfra as it is.

<!-- toc -->

- [Next](#next)
  - [A global `tsinfra` that starts the project's copy](#a-global-tsinfra-that-starts-the-projects-copy)
  - [One note for an apply that didn't finish](#one-note-for-an-apply-that-didnt-finish)
- [Planned](#planned)
  - [Running hosts in parallel](#running-hosts-in-parallel)
  - [Live progress](#live-progress)
  - [Reboot](#reboot)
  - [Tasks](#tasks)
  - [Diagnostic logs](#diagnostic-logs)
  - [The `shell` host option](#the-shell-host-option)
  - [Ordering between hosts](#ordering-between-hosts)
  - [Interactive commands](#interactive-commands)
  - [Waiting for a fix to take effect](#waiting-for-a-fix-to-take-effect)
  - [Manual steps](#manual-steps)
  - [Update warnings](#update-warnings)
- [Follow-ups](#follow-ups)
- [Open questions](#open-questions)
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

### A global `tsinfra` that starts the project's copy

A global install gives a plain `tsinfra` on the PATH, in place of `bunx tsinfra`. The global copy is only a launcher. It starts the project's copy, and never runs host scripts itself:

```sh
bun add --dev tsinfra     # the version your host scripts run on
bun add --global tsinfra  # optional, for a plain `tsinfra`
```

- **The global copy hands off to the project's.** It resolves `tsinfra/cli` from the working directory and imports it. The project's copy resolves to its own path, so it skips the hand-off and runs normally.
- **There's no fallback.** Host scripts import `"tsinfra"`, so the global copy can't run them anyway. Without a project copy, a command that runs hosts fails with "tsinfra isn't installed in this project", and how to add it. Host scripts only ever run on the version in the project's lockfile, whatever the global version is.
- **The error also covers Bun's auto-install.** In a directory with no `node_modules`, Bun installs imports when it runs them, so `import "tsinfra"` would quietly fetch the newest version.
- **`tsinfra --version` shows both,** like `0.9.0 (project)` and `0.8.2 (global)`. The launcher answers it itself, so the project's copy never needs to know it was started by one. Outside a project, `--version` and `--help` answer from the global copy.
- **The hand-off contract never changes.** An old global copy has to start any newer project copy, so the `tsinfra/cli` export stays where it is for good. It's the only thing the launcher relies on.
- **A failed hand-off says to update both copies.** When `"tsinfra"` resolves from the working directory but `tsinfra/cli` doesn't, or importing it fails, the launcher says it couldn't start the project's copy and to update both copies. The launcher can't tell a contract change from any other failure, so the message covers the one cause updating fixes, if the contract ever has to change.

Without a global install, direnv's `layout node` or mise's `_.path` put the project's `node_modules/.bin` on the PATH inside the repo, for the same plain `tsinfra`.

When it's built, the README's Installation drops "not globally" and shows both installs, its examples use a plain `tsinfra`, and [Runtime](./README.md#runtime) says what the global copy does in place of "A global install would not resolve that import". The direnv and mise note goes in the README as a tip.

### One note for an apply that didn't finish

After an apply fails, the next pass shows every step that changed in it, and is right now, as `^ resume`, each with the same note: "an earlier apply didn't finish, so its follow-ups that didn't complete still trigger". tsinfra can't tell which of them still have follow-ups to come, because a run names its steps only when the script reaches it, so they all show (see [Steps](./steps.md#when-an-apply-doesnt-finish)). A late failure in an apply that changed a lot, like a host's first, leaves a block of identical notes, and open changes from more than one failed apply pile up until a clean one.

- **The note moves to the host.** Open changes belong to a host, so its block says once, before its entries, that an earlier apply didn't finish, and that its follow-ups that didn't complete still trigger. Each `^ resume` line is left bare.
- **`ranFromOpenChanges` runs share it.** Their note, "triggered because it didn't complete in an earlier unfinished apply", has the same cause, so the host's note covers them too, and their `> triggered` lines are left bare.
- **It shows at the default level,** like the `resume` lines it explains, and only when the block has a `resume` or `ranFromOpenChanges` line.

When it's built, [CLI](./cli.md#how-the-report-is-built) describes the host's note in place of the two per-step notes, and [Steps](./steps.md#when-an-apply-doesnt-finish) drops the quoted notes.

## Planned

Decided, and wanted eventually, with no place in the order yet.

### Running hosts in parallel

Hosts run one at a time today. `--parallel <n>` runs up to `n` at once (default 8), with each host's output held until it finishes, and the live progress area under the finished blocks. Steps within a host still run one at a time, in order.

### Live progress

While hosts run, the output shows what tsinfra is doing, and each host's progress turns into its report when it finishes:

- **A live line per running host,** with a spinner and the step it is on. The current step comes from the host's record, because a step's record is pushed when the step starts.
- **A permanent block per finished host.** When a host finishes, its live line goes away and its block prints above the live area, where it stays. The block is the same text `renderHostBlock` produces, so the live view and the report never disagree.
- **The summary** prints once every host has finished.

This uses [Ink](https://github.com/vadimdemedes/ink). Its `<Static>` component is this pattern exactly: what it renders prints once and stays, while the rest of the output redraws below it. Ink also captures `console.log` from a host script and prints it above the live area, so a script's own output can't garble the live lines. When stdout is not a terminal, Ink prints the `<Static>` items and skips the live area, so CI and pipes get only the blocks and the summary. That was checked under Bun with Ink 8.

[listr2](https://github.com/listr2/listr2) was the alternative. It is a task list with spinners and a concurrency limit, and it is much smaller than Ink. It does not fit this design:

- **It controls the layout.** Finished tasks stay in their place in the list, with its own symbols and indentation. A block with diffs could only go in a task's output, formatted by its renderer.
- **It keeps list order, not finish order.** A host that finishes early would not print before the ones above it.
- **Its non-terminal output is its own.** Its fallback renderers print lines like task started and completed, not the report.
- **It does not capture a script's `console.log`,** which would write into the middle of its live lines.

Live progress comes with `--parallel`, because that is when hosts run at once, so progress matters. Until then the blocks print directly as each host finishes, and a [progress line](./cli.md#how-the-report-is-built) on stderr says which host is running. The live area replaces it. These details are still open:

- **What tells Ink to redraw.** A spinner redraws on a timer anyway, so the live lines could read the records on each tick. The other option is a callback from the session recorder when a step starts or finishes.
- **How much a live line shows.** It could be only the step's name, or also the command running inside it.
- **Long lines.** A failure's error can be wider than the terminal. The terminal wraps it, but the wrapped part loses its indent. `Bun.wrapAnsi` could wrap it to the terminal's width and keep the indent, but then the output depends on where it runs. Decide once real error output shows whether it's needed.
- **Testing.** `ink-testing-library` renders a component to text frames. The formatting functions keep their own tests either way, because they are plain functions.

### Reboot

A host running Incus needs it after a kernel change. Until then, it reboots by hand, or with the [reboot recipe](./recipes.md#a-reboot).

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

`h.reboot(options)` reboots the host, waits for it to come back, and carries on with the script. Running `reboot` with `exec` would drop the connection, so the command would look failed, and nothing would wait for the host. A reboot is a follow-up to a change, not state a check can read, so it works like a [`run`](./steps.md#run):

- **`after` decides when.** It reboots when a step it follows changed, or on every pass with `"always"`. In `plan` it never reboots, and shows as a `>` line, so later steps are checked against the host as it is, like any step after a change.
- **How it works.** It reads the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl -n kern.boottime` on macOS), starts `sudo reboot` in the background so the command returns cleanly, drops the ControlMaster socket, and polls until the host answers. Then it reads the boot id again. An unchanged boot id fails the step with `the host didn't reboot`, so a host that never went down doesn't count, the same check Ansible's `reboot` makes.
- **One `timeout`** covers going down and coming back. Ansible splits it in two, which mostly helps it word its errors.
- **It escalates like any command,** through the `sudo` function, so the host declares `sudo` on `host()` (see [Transport](./transport.md#sudo)).
- **`@local` refuses it,** with `can't reboot @local, because it's the machine tsinfra runs on`.
- **It's a top-level step.** A fix that installs a kernel doesn't reboot by itself, and the script follows that step with `h.reboot`.
- **It follows the same [open change](./steps.md#when-an-apply-doesnt-finish) rules as a run.** It opens its change before it reboots, records itself on the open changes it follows, and triggers from one that doesn't list it, as `ranFromOpenChanges`. One that didn't trigger, but whose change is still open, is `resume`.
- **It follows the same [`"always"`](./steps.md#run) rules as a run.** A reboot with `after: "always"`, or one that follows only `ranAlways` steps, is `ranAlways`, and `plan` shows it only from `-v`.
- **It returns a `ChangeStepResult<"reboot">`,** so a run can follow it. `"reboot"` joins `ChangeStepKind`, and a run's `after`. Like a run's, it can't be needed, because nothing about the host's state says a reboot happened.

### Tasks

A host can have named tasks besides its main function, for work you run on demand, like updates. Configuring a host and updating it use the same steps, but an update shouldn't happen every time the configuration changes:

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

- **A task is an ordinary host function,** with the same `h`, steps, `plan`, `apply`, session, and sudo prompt. With `want: []`, `plan --task update` lists what would upgrade on every host.
- **`task(name, fn)` mirrors `host(config, fn)`,** and `host()` registers its tasks explicitly with `tasks`, so a task only belongs to the hosts that list it. A task exported from a shared module doesn't register itself anywhere.
- **Define a task above the `host()` call,** because `host()` reads `tasks` straight away, and a `const` can't be read before its line.
- **Task names are unique within a host.**
- **It isn't tags.** Tags pick steps inside one script. A task is a separate function, so each one still reads top to bottom.

### Diagnostic logs

Logs are separate from the report. They are for working out what tsinfra itself did, like which SSH command it ran, how long a connection took, or why it failed. They use [LogTape](https://logtape.org) and go to stderr, so stdout stays the report.

- **LogTape** has no dependencies and supports Bun. It stays silent until the application configures it, which matters because host scripts import tsinfra as a library. It ships a JSON Lines formatter, and `@logtape/pretty` for readable terminal output.
- **`@optique/logtape`** adds the logging options to the existing Optique parser: `--log-level` and `--log-output`. It can also add a `-v`/`-vv` form, which tsinfra leaves out, because `-v` already sets how much the report shows (see [CLI](./cli.md#output)).

LogTape is its own feature, added on its own.

### The `shell` host option

Decided on 2026-11-11, and skipped from the SSH pieces because nothing needs it yet. It's for a tool whose PATH only a login shell loads (see [Login shells](./transport.md#login-shells)).

```ts
export default host({ name: "caddy", target: "caddy.lan", shell: ["bash", "-l", "-s"] }, async (h) => { ... })
```

The host option `shell` replaces the whole command that starts the host's shell, as an array of words. The default is `["sh", "-s"]`. The control machine's own commands, like `ssh -G`, keep `sh -s`.

- **The option is the whole command, `-s` included.** tsinfra adds no flag to it, because it can't know how another shell reads its script. The one requirement is that the shell reads its script from stdin.
- **Each word reaches the shell as written.** Locally, tsinfra runs the array as the process's arguments. Over SSH, ssh joins its arguments into one string, and the user's login shell parses it, so tsinfra quotes each word with `quoteShellArg` first. A single string would mean two things. Split locally, `bash -c 'x'` gives bash the quotes as part of its script. Over SSH, the login shell removes them.
- **`sudo: true` runs the same shell,** as `sudo <shell> <<'<delimiter>'`, with each word quoted. Under sudo, `-l` loads root's profile, not the user's, because sudo sets `HOME` to root's.
- **tsinfra checks nothing about the shell.** Picking one that works is the user's job. The commands tsinfra writes, like the `{ ... } </dev/null` wrapper, the `sudo` function, and `file`'s scripts, are POSIX sh. So the shell must be POSIX compatible, and fish is not. A shell that can't run them fails preparation's first command.
- **Its tests:** a local `env` word that sets a variable the script reads, and over SSH a `sh -l` that sees an export from the SSH user's `.profile`.

A login shell has two pitfalls, which the user docs should warn about:

- **Anything the profile prints lands in every command's stdout.** That breaks preparation's home directory read and `file`'s details, so a profile that prints can't be used.
- **`bash -l` may not load PATH set in `.bashrc`.** A login bash reads `.profile`, which on Debian sources `.bashrc`. Debian's `.bashrc` stops early in a non-interactive shell, so a PATH line at its end never runs. Move the line into `.profile`. Adding `-i` loads `.bashrc`, but an interactive bash reading a pipe writes prompts and job-control warnings to stderr, which lands on the record.

A `path` option may fit that case better (see [Maybe later](#maybe-later)).

### Ordering between hosts

A tentative design, to build after `--parallel` and most of the rest of this section. Until then, an Incus host and its containers run as separate commands.

One host can rely on another. An Incus host has to create a container before the container's own script can run, and a database host may need to be up before an app host. A host declares this with `needs`, which takes the host scripts it imports:

```ts
import incus from "./incus.ts"

export default host({ name: "sonarr", target: "sonarr.lan", needs: [incus] }, configure)
```

- **It's named `needs`, not `after`.** On a `run`, `after` means "only if those changed", but `sonarr` runs whether or not Incus changed. A step's [`needs`](./needs.md) already means "depends on this, and waits in `plan`".
- **It takes imports, not names,** because a step's `needs` takes values too, and an editor catches typos and follows renames. An import cycle fails when the scripts load, with a confusing error.
- **Hosts run after what they need.** Each host starts once the hosts it needs have finished, which also works with `--parallel`.
- **Preparing has to change.** Today every host is prepared before any script runs, and a container that doesn't exist yet would fail there. A host with `needs` that can't be prepared gets one more try after the hosts it needs finish, and only then fails. A sudo prompt for that host moves to that point too.
- **A new container may not be ready straight away,** so the Incus script should wait for it as its last step.
- **In `plan`, a host that can't be prepared shows as waiting** when a host it needs has changes, like `? needs 'incus'`.
- **A host whose needed host failed is skipped,** and the run exits 1.
- **Picking hosts doesn't add any.** `tsinfra apply sonarr` runs only `sonarr`, because you named it. Order only applies among the hosts being run.

Still undecided: whether a host that can be prepared plans normally while a host it needs has changes. The leaning is yes, because otherwise every container's plan disappears whenever Incus has any change. The stricter rule matches a step's `needs`, and waits whenever a needed host has changes.

Other approaches, and why they lost:

- **Order of the command line,** like `tsinfra apply incus sonarr --parallel 1`. It needs no new concept, but you'd have to remember it every time, and a plain `tsinfra apply` would have no order.
- **Stages or numbered folders.** The whole order is in one place, but a stage also waits on hosts it doesn't depend on.
- **The Incus host declaring its containers.** Adding a container would mean editing the Incus file.
- **Batches and serial runs,** like Ansible's `serial` and `order` and Salt's batch mode. These are for rolling a change through a fleet, which isn't the problem tsinfra solves.
- **An orchestration layer,** like Salt's orchestrate runner, which runs states on one group of hosts, then another. That's a second language for the order of hosts.

### Interactive commands

A tentative design. Some commands need a person at the keyboard, like an installer that asks questions, or a `sudo` that askpass can't reach (see [Transport](./transport.md#sudo)). Commands normally run with their script on stdin and their output captured, so nothing can answer a prompt.

**A command says it's interactive, and tsinfra never tries to detect a prompt.** Nothing tells a terminal that a program is waiting for input. The program just reads its stdin. The only signals are guesses:

- **Output that stops partway through a line,** which is how `expect` works. Progress bars, slow downloads, and spinners that redraw with `\r` look the same.
- **A PTY with echo turned off,** which is what a password prompt does. It only works locally, because over `ssh -tt` the PTY is on the host, and tsinfra can't see its settings.
- **A process blocked reading its terminal,** which only the OS knows (`/proc/<pid>/wchan` on Linux), and only for a local process.

A wrong guess either hangs the run or sends what you typed to the wrong place, so a guess is never good enough.

**An interactive command borrows the terminal.** It's one command, and you answer whatever it asks, as many times as it asks:

- **What takes it.** A `run`'s or a `fix`'s command takes `interactive: true` as a step option. In a function, `exec` takes it as a tool option, so only the command that asks borrows the terminal. `read` and `inspect` don't take it, because they run in `plan`, which never stops for input. It can't go with `input`, because stdin is the person.
- **A terminal lock in the CLI.** A host waits for the lock before its interactive command starts, and releases it when the command exits. Hosts waiting for it queue in the order they asked. With hosts one at a time, nothing ever waits. With `--parallel`, other hosts keep running until they reach an interactive command of their own, then wait their turn. The sudo password prompts in preparation go through the same lock.
- **What you see.** The live area pauses, and a header names the host and the step, like `host 'macbook' · Upgrade casks`. The command's output goes straight to the terminal. When it exits, the live area comes back, along with any host blocks that finished while the terminal was borrowed. Ink has no built-in pause, so how the live area steps aside is decided with [Live progress](#live-progress).
- **The command gets a real terminal.** That's a PTY locally (`Bun.spawn`'s `terminal` option), and `ssh -tt` remotely. A PTY merges stdout and stderr, and would echo a script sent on stdin, so the script travels the normal way to a temp file on the host first, and the terminal runs `sh <file>`. The login shell still only parses a fixed command, so the content needs no quoting for it. `BatchMode` stays, because it covers ssh's own prompts, not the command's.
- **The record holds no output.** tsinfra doesn't see what goes to the terminal, so the step's record has the command, that it ran interactively, and the exit code. A PTY could copy the output into the record, but it arrives with stdout and stderr merged and full of escape codes, so that waits until it's needed.
- **Ctrl-C goes to the command,** not the run, while the command has the terminal.
- **No terminal, no interactive command.** When stdin or stderr isn't a TTY, an interactive command fails its step without running, the same way a host that needs a sudo password prompt fails in preparation.
- **`plan` marks a step with `interactive: true`** that would change, so the need for a terminal shows before `apply`. An interactive `exec` inside a function only shows when it runs, because `plan` never runs a fix.

**Answers a script gives itself** could come later, as an `answers: [{ match, send }]` option, for a prompt you'd rather automate than answer by hand. It would detect prompts the `expect` way, so it fits only a prompt whose text is known and that waits with nothing else printing.

Other approaches, and why they lost:

- **A PTY that relays each prompt.** tsinfra would run every command under a PTY, spot each prompt, and queue it as a question to answer. Spotting the prompt is the guessing problem above.
- **Handing a local command the terminal itself** (`stdio: "inherit"`). Ctrl-C would reach tsinfra too, because the terminal sends it to every process in the foreground group. With a PTY, tsinfra passes the keypress on to the command instead.

### Waiting for a fix to take effect

Some changes show only a moment after the command that makes them returns. `launchctl bootstrap` returns before the job is running, and a container's health check starts as `starting`. The check after a fix runs straight away, so it can see the old state and fail the step even though the fix worked. Today the fix waits itself, with a loop at its end (see [Recipes](./recipes.md#waiting-for-a-change-to-take-effect)).

tsinfra needs a way to wait between a fix and the check after it. How is still open:

- **A wait on `verify`,** like `verify: { timeout: 30_000 }`, which runs the check again until it matches or the time is up. `plan` runs the check once, so it never waits. When time runs out, the step fails with the last check's `got:` and `want:`, like any fix that didn't work.
- **A helper the fix calls,** like `waitFor`, at the end of the fix.

A fix may also need to wait between its own commands. `launchctl bootout` returns before the job is gone, so a fix that reloads a job waits before its `bootstrap`. A `verify` option can't reach that, and a helper can, so the two may both be needed. [Retries on a fix](#maybe-later) is a different case, a fix that fails now and then.

### Manual steps

For work no command can do: pressing a pairing button, a login URL from `tailscale up`, an App Store sign-in for `mas`, a macOS permission like Full Disk Access, or a setting only a GUI can change. It's shaped like `ensure` with instructions in place of a fix, like `h.manual(name, { want, check, instructions })`.

- **`plan` shows it as `manual`,** with the instructions under its status line, so work you have to do doesn't read like a `~ change` tsinfra will make. It's still drift, so `plan` exits 2. The symbol is open, because `!` is `failed`'s.
- **`apply` prints the instructions, waits for Enter, then checks again.** A step with a check stops prompting once the work is done, which an unconditional pause like Ansible's `pause` can't do. An unconditional pause also makes a second `apply` stop again, and hangs an unattended run.
- **It reuses the sudo prompt's pieces:** `readHiddenLine`, Ctrl-D to skip the host, Ctrl-C to cancel the run, and failing the host without a TTY. A host script can't prompt by itself, because tsinfra owns the terminal once hosts run in parallel. Its prompt comes mid-run, not in preparation, so it waits for the terminal lock in [Interactive commands](#interactive-commands), and the live progress area pauses while it's open.
- **Today** an `ensure` whose fix fails with the instructions does the same job with a rerun, because every earlier step is already right (see [Recipes](./recipes.md#a-reboot)).

### Update warnings

Each copy of tsinfra warns when a newer version is out. The global launcher (see [A global `tsinfra` that starts the project's copy](#a-global-tsinfra-that-starts-the-projects-copy)) checks its own version, and the project's copy checks its own. Neither knows about the other, so a run can show both warnings, one, or neither.

- **Neither copy updates anything.** A global install could come from any package manager, so tsinfra doesn't guess how to update it, and changing a global install for someone oversteps.
- **The check never slows a run.** The newest version is fetched from the npm registry at most once a day and cached on the machine running tsinfra, at `~/.tsinfra/latest-version.json`. A warning comes from the cache. A fetch still running when the run ends shows its result on a later run.
- **The two copies share the cache.** It holds only the newest version and when it was checked, and each copy compares its own version to it. Its format is a contract that never changes, like `tsinfra/cli`, because an old global copy reads what a newer project copy wrote.
- **A cache a copy can't read says to update both copies,** the same as a failed hand-off. The copy can't tell a format change from a corrupt file, so the message covers the one cause updating fixes.
- **The launcher warns before it hands off.** The project's copy may exit the process itself, so the launcher has no later point to print from. It reads the cache and never waits for a fetch.
- **Each warning names its own copy.** The project's says how to update with the package manager its lockfile shows (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`). The global's says to update it the way it was installed, with a `bun add --global` example.
- **The warnings stay out of the way.** They go to stderr, after the report for the project's copy, and never change the exit code. They're skipped when stderr isn't a TTY, in CI, or when an opt-out environment variable is set.

## Follow-ups

Fixes and finishing work for what's already built.

- **Stop remote commands on Ctrl-C.** Without a terminal, Ctrl-C ends the local `ssh`, but the command on the host keeps running. nixos-rebuild runs a remote `pkill -SIGINT` when it's interrupted. tsinfra needs the same, with the process to stop known, and the run's connections still closed.
- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the wrong step. `callStep` already builds a fresh set of tools for each step. What's left is to bind them to the step's record, and fail the host through `callOrFail` when that step is no longer the running one. Do not throw in `recordCommands`, because only `session.ts` throws, and a throw there would skip recording the failure in `callOrFail`.
- **Keep forced color out of commands.** `runProcess` starts the local shell with tsinfra's whole environment, so a `FORCE_COLOR` or `CLICOLOR_FORCE` that a task runner sets reaches every command on `@local`. bask sets `FORCE_COLOR=1` whenever its output is a terminal. A command then colors output a check parses, like `bun pm ls -g`, whose names stop matching the wanted ones and show as both missing and extra. Remove both variables from the environment `runProcess` passes, and leave `NO_COLOR`, because it only turns color off. The report keeps its own color, because it reads `process.env` in tsinfra's process. SSH hosts don't get them, because ssh only forwards the names in `SendEnv`.
- **Run the Docker tests in CI.** Only `bask test --all` runs the Docker tests, never `bask lint`, because they need Docker and download images and packages, so nothing runs them automatically yet.
- **Check SELinux labels on a VM.** `file`'s `chcon` and `restorecon` are untested on real labels, because containers run with SELinux off.
- **The user docs.** These docs will be published as a documentation site built with [Starlight](https://starlight.astro.build). When it gets written, start from [Recipes](./recipes.md), and add the comparison with other config tools from the [design notes](./README.md#compared-with-other-tools), led by tsinfra's strengths. Warn about a login shell's pitfalls once [the `shell` option](#the-shell-host-option) exists.
  - **The AI features come from `starlight-llm-actions`:** a copy-as-Markdown and open-in-ChatGPT/Claude menu, a `.md` copy of each page, `llms.txt`, and a `rel="alternate"` link to the Markdown. Serving Markdown at a page's own URL when an agent sends `Accept: text/markdown` is a rewrite rule on the host, because a static site can't see headers.
  - **Each page needs a `title` in its frontmatter,** because Starlight doesn't read the H1. Links like `./steps.md#commands` need rewriting to routes, because Starlight doesn't resolve `.md` links. `starlight-links-validator` checks links and anchors across pages.

## Open questions

What still needs an answer. Most are best settled by porting real hosts first.

### Integrations worth shipping

An integration is a set of functions that take `h` and call steps to set up one specific program, service, or piece of config, like apt packages or systemd units. The candidates are in [Integration ideas](#integration-ideas). Start each as a function in a host repo, and move one into tsinfra only once two hosts use it the same way.

An integration configures the host itself: its packages, services, files, users, and settings. It doesn't manage objects inside an app, like a database's users, or resources behind an API, like DNS records, because those belong to the app's own tooling or to tools like Terraform. And no integration installs and runs one app for you, like a Postgres or Tailscale module. A script does that with the general integrations.

Each family of shipped integrations gets its own export path, like `tsinfra/apt` or `tsinfra/systemd`, so a script imports only the families it uses. The root, `tsinfra`, stays the core API: `host`, and every type a script annotates with. The file mode constants stay in the root too, because they're values for a core step's option, and their types have to be there for `FileOptions`. A subpath is an entry file like `src/facts.ts`, an `exports` entry in `package.json` with `types` and `import` like the root's, and whatever the build and knip need to treat it as an entry.

### Fact helpers

A fact is something read from the host that no step changes, like the CPU architecture, which is what a script may branch on (see [Steps](./steps.md#choosing-a-method)). Today a script reads one with `h.read`. A few helpers would normalize the common ones. A fact helper only reads something no step can change:

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

- **Each takes `h` and runs at the top level only.** A helper is an ordinary `h.read` with the normalizing added, so it shows as its own `·` line in `--verbose`, the same as a helper a script writes itself. A step uses the fact through the closure, as above. Calling a helper inside a step's function fails the host with `'read' can't run while ensure step 'X' is running`, like any other call on `h` there.
- **There's no hidden way to run commands.** A helper that reached the shell around `h` would skip the session recorder and the failed-host check, and would follow rules a script's own helpers can't.
- **The value is in the normalizing.** `uname -m` prints `x86_64` or `aarch64` on Linux and `arm64` on macOS, and download URLs want `amd64` or `x64`. Node's names give the host the same vocabulary as the control machine. If a step ever needs the normalizing inside its function, the pure part can be exported too, like `toNodeArch(await read("uname -m"))`.
- **`os-release` covers every current Linux** through one standard file, with no per-distribution cases.
- **No fact system.** pyinfra has fact classes with a command and a parser, `host.get_fact`, a cache, and defaults for a missing command. tsinfra leaves those out, because a fact read once at the top of a script is just a `const`. A missing command is already an answer through `inspect`.
- **No facts about state a step manages,** like whether a file exists, a package is installed, or a command is on the `PATH`. Those belong in a step's check, where `plan` reads them at the right time. A `hasCommand` helper would invite the wrong shape from [Steps](./steps.md#choosing-a-method), an `inspect`, an `if`, and a `run`, instead of an `ensure` with `check: "command -v docker"`. A prerequisite nothing in the script installs is checked with `h.inspect` and a `throw` (see [Needs](./needs.md#a-prerequisite-nothing-in-the-script-installs)). pyinfra's docs warn about the same thing: "Only use immutable facts in deploy code (installed OS, Arch, etc)".
- **Container detection is left out** until a port needs it, because it differs across Docker, LXC, and systemd.

Build them once ported hosts show which facts the scripts actually branch on.

### Following symlinks in `file`

`file` refuses a path that is a symlink, so it never replaces a link with a regular file, or writes somewhere the script didn't name (see [Steps](./steps.md#file)). Making a link is [`link`](./steps.md#link)'s job. This question is only whether `file` should follow an existing link and write to its target instead. The tools split on this. Chef writes through the link to its target, and Ansible makes it an option. Following links would mean the file details script resolves the real path first and reports it, and the write goes there. Decide when a port needs to manage a file that is reached through a symlink.

### Files over 10 MB

`file` sends content in a base64 heredoc inside the write script, which the shell holds in memory before it runs, and base64 adds a third. `input` travels the same way. That is fine for config files, so content or input over 10 MB is refused (see [Steps](./steps.md#file)). A larger input, like an image for `docker load`, waits on this too. A `Blob` from `Bun.file` already offers `stream()`, so a streaming path could read the local file in chunks too. Every agentless tool uses SFTP or scp instead, which streams. A streaming path for large files would upload with `scp` to a temp file in the destination's directory as the SSH user, which works without `sudo`. With `sudo`, it needs a user-writable place and a root `mv`, the two-hop step the heredoc avoids. Add it when a port needs a large file.

A streaming path would also be faster on a host whose `sh` is bash, which reads the script one byte at a time, so 10 MB of content takes it about 2.5 seconds (see [Transport](./transport.md#file-writes)).

### `fsync` before the rename

The write doesn't `fsync` the temp file before the rename (see [Transport](./transport.md#file-writes)). After a crash at the wrong moment, the file could be in place but empty. Puppet and Salt `fsync`, and Ansible and Chef don't. `sync "$tmp"` would add it, but busybox ignores the argument and flushes everything. Add it if a host turns out to lose power or crash often enough to matter.

### Backups of replaced files

Chef, Puppet, Ansible, and Salt can each keep a copy of the file they replace. tsinfra doesn't, because the script in version control is the record of what a file should be, and `plan` shows the diff before anything changes. Revisit if a port manages files that something else on the host also edits.

### Steps side by side within a host

Steps on one host run one at a time, and a step that starts while another is running fails the host (see [Steps](./steps.md#commands)). That is how the session knows which step a command belongs to, with one variable for the current step. Running steps side by side is not worth supporting yet:

- **Order usually matters.** You install before you configure, and the plan reads the same way on every run.
- **The slow steps tend to collide.** Two `apt-get install` steps fight over the dpkg lock.
- **Most of the waiting is across hosts,** which `--parallel` will cover.

Commands inside one step can already run at once, with `Promise.all` over `exec` in a fix. If a host ever needs steps side by side, `AsyncLocalStorage` from `node:async_hooks` can track the current step for each async chain instead of one variable for the host.

## Ideas

Features other tools have that could fit tsinfra, from a survey of pyinfra, Ansible, Salt, Chef, Puppet and Bolt, cdist, Rex, Nix with home-manager and nix-darwin, mgmt, chezmoi, dotbot, yadm, Comtrya, Fabric, Pulumi, and Terraform with OpenTofu, in November 2026. None is decided.

### Integration ideas

Integrations that might ship (see [Integrations worth shipping](#integrations-worth-shipping) for what one is). Each is weighed on its own, and none is decided. One that ships follows the rule, scope, and packaging in [Integrations worth shipping](#integrations-worth-shipping). An idea with notes so far links to them in [Integration notes](#integration-notes). "Maybe" marks the ones less likely to be worth it. Other tools' catalogs suggested most of these (pyinfra's operations, Ansible's modules, Salt's states, Chef's resources, cdist's types, nix-darwin, and home-manager).

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
- [launchd agents and daemons](#launchd)
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

- maybe: [system settings](#system-settings) in one integration: hostname, timezone, locale, `/etc/hosts`, sysctl, kernel modules, mounts, swap, cron, logrotate, motd, and macOS power settings
- maybe: a firewall, like ufw
- maybe: wait for a port or URL

**Other**

- [A run-once marker](#run-once-marker)
- [A 1Password reader](#1password-reader)
- [Facts: CPU architecture, platform, and OS release](#fact-helpers)
- [Full-set cleanup, which removes what isn't declared](#removed-resources)

**Left out:**

- **Editing JSON or replacing by regex** belongs in TypeScript. A script reads the file, changes it, and writes it with `file`.
- **Databases' users and tables, DNS records, and TLS certificates** are objects inside an app or behind an API (see [Integrations worth shipping](#integrations-worth-shipping)).
- **Validating a file before it's written** is already `file`'s `validate` option.

### Integration notes

What's known so far about the ideas in [Integration ideas](#integration-ideas).

#### Homebrew

`tsinfra/brew`: a Brewfile, an `ensure` on `brew bundle check --no-upgrade` with `HOMEBREW_NO_AUTO_UPDATE` set, and nix-darwin's cleanup modes. `plan` computes the extras itself, because `brew bundle cleanup` prompts. The Brewfile goes to `brew bundle --file=-` through `input`, or is written with `file` when it's useful on its own, like for running `brew bundle --global` by hand.

#### Portable integrations

One integration over several tools, picking the one the host has, like pyinfra's `server.packages` and `server.service` and Ansible's `package` and `service`. A package integration picks apt, apk, or brew, and a service integration picks systemd, OpenRC, or launchd. Ansible's docs say its `package` covers only "the minimum intersection" of the tools' options, so a script that needs one tool's options uses that tool's integration.

#### Remote file

Like pyinfra's `files.download`, Ansible's `get_url`, and Chef's `remote_file`: fetch a URL on the host and check it against a checksum. It may be an `ensure` with a recipe, or an option on `file`, rather than an integration.

#### System settings

One integration that takes an object of the settings to set, and sets only the keys given, like hostname, timezone, locale, `/etc/hosts` entries, sysctl, kernel modules, mounts, swap, cron, logrotate, motd, and macOS power settings. Other tools have a step per setting (pyinfra's `server.hostname`, `server.sysctl`, and so on).

#### Docker images

`tsinfra/docker`: container integrations, starting with the `want: []` `ensure` that keeps running containers on the newest images (see [Recipes](./recipes.md#running-the-latest-container-images)), if the Docker container ports repeat it.

#### Lines in a file

`tsinfra/files`: a managed block between marker lines, like Ansible's `blockinfile`, Salt's `file.blockreplace`, and pyinfra's `files.block`. Maybe a single-line function too, though Ansible itself warns against overusing `lineinfile`, and pyinfra's unanchored `files.line` match also catches `#foo` when you meant `foo`. Puppet's `file_line` has the cleanest options: `line`, `match`, `after`, and `multiple`.

#### macOS defaults

`tsinfra/macos`: each `defaults` key as an `ensure`, with `defaults read` as the check and `defaults write` as the fix, and a run that restarts Dock or Finder after. `defaults read` prints booleans as `1` and `0`. Like nix-darwin, a removed key stays as it was.

#### launchd

What a port with about 100 lines of launchd handling ran into. The [waiting recipe](./recipes.md#waiting-for-a-change-to-take-effect) works around all of them.

- **`launchctl bootout` returns before the job is gone,** so a `bootstrap` straight after it fails with an I/O error. Reloading a job waits for `launchctl print` to fail before the `bootstrap`.
- **`launchctl bootstrap` returns before the job is running,** so the check after the fix waits for it (see [Waiting for a fix to take effect](#waiting-for-a-fix-to-take-effect)).
- **A loaded job isn't a running one.** launchd keeps a `KeepAlive` job loaded while it crashes on every start, so the check reads the job's `state` from `launchctl print`, like `running` or `spawn scheduled`. systemd has the same trap, where an enabled unit isn't necessarily `active`.
- **`launchctl print` has nested `state` lines,** like `state = active` for an endpoint, so the job's own is the one indented by one tab.

#### Run-once marker

Like chezmoi's `run_once_`: save a hash of the command in the host's [saved state](./transport.md#saved-state), and check for it.

#### 1Password reader

Like chezmoi's `onepasswordRead`: run `op read` with Bun `$` on the control machine and pass the value to `file` with `secret`. Every `plan` has to read the secret to compare it, so every plan prompts.

### Maybe later

Opt-in features with no real case yet:

- **`--json`** writes the report as one JSON document on stdout instead of the text blocks, for scripts and CI. It would serialize each host's record (see [CLI](./cli.md#what-a-host-records)), with each error as its message chain, and a version field so the shape can change later. Terraform's rule for that field works: readers ignore fields they don't know, and refuse a major version they don't support. No library is needed. Diagnostic logs stay on stderr either way, so stdout is only the document. Add it when something needs to read the output.
- **A shell-quoting helper,** exporting the `quoteShellArg` tsinfra already uses for its own commands. A list of values whose shape isn't fully trusted could then go into a command's text safely, like `` `apt-get install -y ${missing.map(quoteShellArg).join(" ")}` ``, which `env` doesn't handle well, because a variable holds one string. It adds to the public API, so add it when a script needs it.
- **Host scripts found by a glob,** like `--hosts 'machines/*/host.ts'`, for a repo that keeps each machine's files together in its own folder. Discovery only reads the `.ts` files directly inside `--hosts-dir`, so today each machine gets a one-line re-export in `hosts/`, like `export { default } from "../machines/macbook/host.ts"`. tsinfra has no config file, so the glob would be on every command.
- **`tsinfra exec <host> -- <cmd>`** runs an ad-hoc command on a host's target without its script, like `pyinfra INVENTORY exec`.
- **`--fail-fast`** stops starting new hosts once one fails, like Ansible's `any_errors_fatal` and Salt's `failhard`. With `--parallel 1`, it works as a canary rollout.
- **`apply --confirm`** plans, prints the report, asks, then applies, like Terraform's `apply` prompt.
- **Retries on a fix,** like Ansible's `until`, Salt's `retry`, Chef's `retries`, and pyinfra's `_retries`. A `retry()` helper inside the fix may be enough. Waiting for a fix that worked to show is planned separately (see [Waiting for a fix to take effect](#waiting-for-a-fix-to-take-effect)).
- **`backup` on `link`,** for the first dotfiles run, where real files sit where the links go. home-manager's `-b` moves them aside and aborts if the backup already exists. If backups come back for `file`, Puppet's same-folder copy with an extension is the lightest model (see [Backups](#backups-of-replaced-files)).
- **A `tempFile` tool,** for a command that only takes a path, not `input` on its stdin (see [Steps](./steps.md#commands)). It would write the data to a temp file and remove the file when the step ends. It would be a change tool only, because a temp file a check writes is a write during `plan`. The tools have no hook for the end of a step yet, so a fix writes the temp file with `mktemp` and `cat` today. Add it when a port needs a command that can't read stdin.
- **An argument list as a command,** like `exec(["tar", "-xzf", name])`, rendered by quoting each element with `quoteShellArg`. It's safe for any value, with no variable to name, like Ansible's `command` module and Chef's array form of `execute`. Pipes, redirects, and `$VAR` don't fit it, so it would sit beside command strings, not replace them. Add it if the ports show many commands built from values.
- **A programmatic `plan()` and `apply()`** that return host records, like Pulumi's Automation API.
- **A container transport,** like pyinfra's `@docker/<name>` connector, with the same `@` syntax as `@local`: `@incus/<name>` through the local `incus` client and a configured remote, and `@docker/<name>` through `docker exec -i`. Every command already goes to `sh -s` on stdin, so only the command that starts the shell changes. Commands run as root, so `~/` means `/root`. Incus containers can just be reached over SSH, and Docker app containers are usually replaced rather than configured, so neither needs it yet. Deferred.
- **Run something before a change, only when the change will happen,** like Salt's `prereq`, which drains a load balancer before a deploy, and Chef's `notifies ... :before`. The likely shape is a `before` option on `file`, and maybe `link`, taking a command or a function given `exec`, like a fix. It runs only in `apply`, only when the comparison shows a change, and right before the write, and `plan` lists it under the change. The case is an app that writes its config when it stops, like qBittorrent: stop it in `before`, and start it with a `run` whose `after` names the `file`. A `run` with `after` already covers the half after the change, and an `ensure`'s fix can start with the stop, so neither needs a hook.
- **Reset the connection,** like Ansible's `meta: reset_connection`. A user added to a group, like `incus-admin` or `docker`, doesn't get it in commands that reuse the ControlMaster connection that logged in before the change. A rerun within `ControlPersist` reuses it too. Dropping the master makes the next command log in again. `h.reboot` will drop it too, so the two can share that code. Until then, use `sudo`, or `sg <group> -c '...'`.
- **Log in with an SSH password,** like Ansible's `--ask-pass`. Today `BatchMode=yes` stops ssh from prompting, so a host that only takes a password fails in preparation with ssh's `Permission denied (publickey,password)`. ssh can ask a helper instead of the terminal, with `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4 and later), the same way sudo's askpass works. The helper runs on the control machine and prints a variable, so it holds no secret. Only the connection that opens the ControlMaster logs in, so a host needs the password once per run. It fits the sudo prompt's flow: `buildHostDetails` stops a host whose `Permission denied` lists `password`, then `finishHostDetails` prompts for it, opens the connection, and goes straight on to sudo, prompting for that too if needed. Each host's prompts come together, one host at a time. A key's passphrase would come through the same helper, and ssh's prompt text tells the two apart.
- **A `path` host option,** a list of directories prepended to `PATH` in every command, like pyinfra's `_env` and Ansible's `environment`, but only for PATH. It covers the case the `shell` option is for, a tool installed outside the default PATH, like Go's. It has none of a login shell's pitfalls (see [The `shell` host option](#the-shell-host-option)).
  - **How it works:** a transport wrapper, like the one that adds the `sudo` function, starts each script with `PATH=<entries>:"$PATH"` and `export PATH`. It wraps each command after the recorder has seen it, so the record shows the script as written.
  - **Under sudo:** sudo resets PATH to its `secure_path`, so a `sudo: true` step gets the same line inside its nested shell. A `sudo` command inside a script still gets sudo's own PATH.
  - **Entries:** an entry must be absolute or start with `~/`. A `~/` entry resolves against the home directory that preparation reads, like `file`'s paths. An entry can't hold `:`, because PATH splits on it.
  - **Why not `env`:** a step's `env` sets literal values for that one step, so it can't extend `PATH`. `path` would prepend to it in every command on the host.
- **A prompt step that returns a value,** a `read` answered by the user, like `h.prompt(name, { secret: true })`, for values that only exist at run time, like a Plex claim token or a 2FA code. The script decides when to ask, like only when a `read` shows the server isn't claimed yet. It prompts in `plan` too, so later steps can show a real diff. Ansible's `pause` saves its answer the same way.

  It reuses the sudo prompt's pieces and the terminal lock, the same way a [manual step](#manual-steps) does.

- **Ordering between integrations,** not just between steps. To be expanded.

### Removed resources

The lowest priority here, and probably never built. A step the script stops managing leaves its file, link, or package on the host, because there is no record of resources (see [No record of resources](./README.md#no-record-of-resources)). tsinfra doesn't track this, and the automatic approaches are in [Rejected](#rejected). What's left:

- **Turn a step into its removal instead of deleting it.** This is the recommended pattern, and it needs no new feature (see [Recipes](./recipes.md#turn-a-step-into-its-removal-instead-of-deleting-it)). A step deleted without this leaves what it made on the host.
- **A manifest of `file` and `link` paths on the host,** kept in the host's [saved state](./transport.md#saved-state), where `plan` only warns about paths in it that the script no longer manages. The machine stays the only source of truth. A path is the one thing that identifies a step across edits, so this list can be accurate. It wouldn't cover anything done through `ensure`. Add it only if a port shows that forgotten files are a real problem.
- **A full set whose contents can be listed.** An integration can find the extras in a set the script declares completely. nix-darwin's Homebrew `cleanup` is `none`, `check`, `uninstall`, or `zap`, and Salt's `file.directory` with `clean: True` and chezmoi's `exact_` folders delete every entry the run didn't declare. A managed folder's `plan` must list every file it would delete.

## Rejected

Recorded so the survey doesn't need redoing:

- **A run that reports nothing changed,** like Ansible's `changed_when` and Salt's `stateful` scripts, as a run function returning `{ changed: false }`. Its case, pulling images and recreating containers only when one is new, is an `ensure` on "the running containers are on the newest images", with a read-only check and `want: []` (see [Recipes](./recipes.md#running-the-latest-container-images)). The run version only made sense because it let the pull sit where a read-only check belongs, and its `plan` showed a change every time.

- **An absent form,** like Terraform's `removed`, chezmoi's `remove_`, and mgmt's `state: absent`, as an `h.remove(path)` step. Deleting a specific path is rare, and an `ensure` that the path is gone already says it and reads well. A new step kind would be a concept with no real case.

- **Removing what a deleted step did, automatically.** Terraform can because each resource's delete logic lives in its provider, which outlives the resource block. `ensure` and `run` run arbitrary commands, so tsinfra can't know how to undo them. Deleting a step is also ambiguous, because it can mean "undo this" or "stop managing this". Stopping managing `/etc/ssh/sshd_config` must not delete it, because tsinfra configures machines that already exist.

- **A saved record of steps, reporting the ones no longer in the script.** Nothing identifies a step across edits. A renamed step looks removed, and a step repurposed under the same name never reports what its old version did. A hash of its commands fails the same way, because a harmless typo fix changes the hash. Whether an edit keeps the step's purpose is known only to its author, and a declared ID would only fix renames. A list that misses things can't show a host is clean.

- **An `undo` attached to a step, run by a flag.** The step stays in the script, so the next `apply` puts the thing back. `plan` never shows the removal, a host that was down misses it, and the undo goes stale because nothing runs it. Saving it on the host, like the removal scripts `dpkg` keeps, can't save a function.

- **Pruning symlinks that point into the repo,** like a `pruneLinks(dir, repo)` step, dotbot's `clean`, and home-manager's generations. A symlink into the repo is a hint, not proof, because anything can create one.

- **Tags, targeting, and `--start-at-task`.** Tags are a non-goal, and idempotent steps make starting partway pointless.
- **`block`/`rescue`, `ignore_errors`, and continuing past a failure.** A failed host stays failed, and `inspect` handles an exit that isn't an error.
- **State-file features:** saved plans, `moved` blocks, refresh-only, generations, and rollback. Rollback is a git revert and an `apply`.
- **Closing [open changes](./steps.md#when-an-apply-doesnt-finish) by hand,** like a flag that deletes them without firing their runs. Open changes exist so nobody has to fix a host by hand. A clean apply closes them anyway, at the cost of a run that's safe to repeat.
- **Guards like `only_if`, `not_if`, `creates`, and `unless`.** `ensure`'s check covers them, and Chef's own docs show guards make why-run inaccurate.
- **Delegation and `local_action`.** The script already runs on the control machine.
- **Plugin systems for output.** JSON output covers what a reader needs.
- **Fact caching and fact systems.** See [Fact helpers](#fact-helpers).
- **Vaults and encrypted files in the repo.** TypeScript can call sops or a password manager directly.
- **Reading every step's state before any fix,** like cdist's stages and pyinfra's prepare phase. It decides on state that's stale by the time the fix runs.
- **Delayed, deduplicated notifications.** A run after both steps with `after: [a, b]` already fires once.
- **Async tasks.** They have no check mode, and SSH keepalives cover long commands.
- **Real-time watching,** like mgmt. A daemon is the full config tool tsinfra isn't.
- **Second languages for plans,** like Bolt's YAML plans and cdist's file-per-parameter types.
