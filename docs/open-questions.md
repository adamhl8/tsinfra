# Open questions

What still needs an answer. Most are best settled by porting real hosts first (see `todo.md`).

<!-- toc -->

- [What `plan` output should look like](#what-plan-output-should-look-like)
- [JSON output](#json-output)
- [Live progress details](#live-progress-details)
- [Interactive commands](#interactive-commands)
- [Published, or personal](#published-or-personal)
- [Helpers worth shipping](#helpers-worth-shipping)
- [Fact helpers](#fact-helpers)
- [A directory step](#a-directory-step)
- [Sending data to a command](#sending-data-to-a-command)
- [Following symlinks in `file`](#following-symlinks-in-file)
- [Files over 10 MB](#files-over-10-mb)
- [`fsync` before the rename](#fsync-before-the-rename)
- [Backups of replaced files](#backups-of-replaced-files)
- [Steps side by side within a host](#steps-side-by-side-within-a-host)
- [Quoting values in commands](#quoting-values-in-commands)
- [Ordering between hosts](#ordering-between-hosts)
- [No state](#no-state)

<!-- tocstop -->

## What `plan` output should look like

[CLI](./cli.md#output) has a first guess. The evidence so far is `~/homelab/justfile`, whose `plan` recipe filters
pyinfra's JSON down to just the names of pending changes. That suggests the default should be terse, with diffs. Settle
it by running `plan` on the ported Mac and reacting to what it shows. How the report is built is settled (see
[CLI](./cli.md#how-the-report-is-built)), so this is only about what it shows.

## JSON output

A `--json` flag would write the report as one JSON document on stdout instead of the text blocks, for scripts and CI.
It would serialize each host's record (see [CLI](./cli.md#what-a-host-records)), with each error as its message chain,
and a version field so the shape can change later. Terraform's rule for that field works: readers ignore fields they
don't know, and refuse a major version they don't support. No library is needed. Diagnostic logs stay on stderr either way, so
stdout is only the document. Add it when something needs to read the output.

## Live progress details

The design is settled (see [CLI](./cli.md#live-progress)). These details are not:

- **What tells Ink to redraw.** A spinner redraws on a timer anyway, so the live lines could read the records on each
  tick. The other option is a callback from the step recorder when a step starts or finishes.
- **How much a live line shows.** It could be only the step's name, or also the command running inside it.
- **Long lines.** A failure's error can be wider than the terminal. The terminal wraps it, but the wrapped part loses
  its indent. `Bun.wrapAnsi` could wrap it to the terminal's width and keep the indent, but then the output depends on
  where it runs. Decide once real error output shows whether it's needed.
- **Testing.** `ink-testing-library` renders a component to text frames. The formatting functions keep their own tests
  either way, because they are plain functions.

## Interactive commands

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

## Published, or personal

The package is set up for npm (`exports`, `bin`, publint, release-it). If tsinfra stays personal tooling for
`~/homelab`, the packaging work is optional. If it is published, it stays.

## Helpers worth shipping

Candidates from the homelab: an apt package step, brew bundle, a systemd unit with reload, a Docker Compose project, and
`put_files` (a map of local files to destinations). Start with them as functions in `~/homelab/lib`, and move one into
tsinfra only once two hosts use it the same way.

Each family of shipped helpers gets its own export path, like `tsinfra/apt` or `tsinfra/systemd`, so a script imports
only the families it uses. The root, `tsinfra`, stays the core API: `host`, and every type a script annotates with. The
file mode constants stay in the root too, because they're values for a core step's option, and their types have to be
there for `FileOptions`. A subpath is an entry file like `src/facts.ts`, an `exports` entry in `package.json` with
`types` and `import` like the root's, and whatever the build and knip need to treat it as an entry.

## Fact helpers

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
await h.ensure("Install the arm build", { check: "...", want: true, fix: `... ${cpu} ...` })
```

- **Each takes `h` and runs at the top level only.** A helper is an ordinary `h.read` with the
  normalizing added, so it shows as its own `·` line in `--verbose`, the same as a helper a script writes itself. A step
  uses the fact through the closure, as above. Calling a helper inside a step's function fails the host with
  `'read' can't run while step 'X' is running`, like any other call on `h` there.
- **There's no hidden way to run commands.** A helper that reached the shell around `h` would skip the step recorder
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

## A directory step

`file` creates missing parent directories with default permissions. pyinfra's `put_files` also manages directory modes.
Add `h.dir(path, { mode })` if a port needs it.

## Sending data to a command

A command's stdin is `/dev/null`, because the script itself travels on stdin (see
[Transport](./transport.md#commands-travel-on-stdin)). A script has no clean way to hand a command data from the control
machine, like a binary built locally, or an image for `docker load`. `exec` can carry the data inside a hand-written
base64 heredoc, but that is the multi-line shell this design avoids. The same gap stops a fix from writing a file,
because `h.file` inside a fix is a step inside a step.

The likely answer is an `input` option in `CommandOptions`, sent to the command's stdin:

```ts
await exec("docker load", { input: imageTarball })
```

A command that only takes a path gets the data written to a file first:

```ts
const tmp = await exec("mktemp")
await exec(`cat > '${tmp}'`, { input: dump })
await exec(`restore-tool --file '${tmp}'`)
```

How the data travels should follow how `file` sends content, base64 in a heredoc (see
[Transport](./transport.md#file-writes)). Add it when a port needs it.

## Following symlinks in `file`

`file` refuses a path that is a symlink, so it never replaces a link with a regular file, or writes somewhere the
script didn't name (see [Steps](./steps.md#file)). Making a link is [`link`](./steps.md#link)'s job. This question is
only whether `file` should follow an existing link and write to its target instead. The tools split on
this. Chef writes through the link to its target, and Ansible makes it an option. Following links would mean the state command
resolves the real path first and reports it, and the write goes there. Decide when a port needs to manage a file that
is reached through a symlink.

## Files over 10 MB

`file` sends content in a base64 heredoc inside the write script, which the shell holds in memory before it runs, and
base64 adds a third. That is fine for config files, so content over 10 MB is refused (see [Steps](./steps.md#file)).
A `Blob` from `Bun.file` already offers `stream()`, so a streaming path could read the local file in chunks too.
Every agentless tool uses SFTP or scp instead, which streams. A streaming path for large files would upload with `scp`
to a temp file in the destination's directory as the SSH user, which works without `sudo`. With `sudo`, it needs a
user-writable place and a root `mv`, the two-hop step the heredoc avoids. Add it when a port needs a large file.

## `fsync` before the rename

The write doesn't `fsync` the temp file before the rename (see [Transport](./transport.md#file-writes)). After a crash
at the wrong moment, the file could be in place but empty. Puppet and Salt `fsync`, and Ansible and Chef don't.
`sync "$tmp"` would add it, but busybox ignores the argument and flushes everything. Add it if a host turns out to lose
power or crash often enough to matter.

## Backups of replaced files

Chef, Puppet, Ansible, and Salt can each keep a copy of the file they replace. tsinfra doesn't, because the script in
version control is the record of what a file should be, and `plan` shows the diff before anything changes. Revisit if a
port manages files that something else on the host also edits.

## Steps side by side within a host

Steps on one host run one at a time, and a step that starts while another is running fails the host (see
[Steps](./steps.md#commands)). That is how the session knows which step a command belongs to, with one variable for the
current step. Running steps side by side is not worth supporting yet:

- **Order usually matters.** You install before you configure, and the plan reads the same way on every run.
- **The slow steps tend to collide.** Two `apt-get install` steps fight over the dpkg lock.
- **Most of the waiting is across hosts,** which `--parallel` already covers.

Commands inside one step can already run at once, with `Promise.all` over `exec` in a fix. If a host ever needs steps
side by side, `AsyncLocalStorage` from `node:async_hooks` can track the current step for each async chain instead of
one variable for the host.

## Quoting values in commands

Computing values in TypeScript means putting them into command strings, and a value with a space or a quote breaks the
command. A tagged template that escapes what is put into it would fix this: `` sh`curl -fsSL ${url} -o ${dest}` ``.
Bun ships `$.escape`, so it would be a thin wrapper. It applies to `check`, `read`, `fix`, `exec`, and `run` alike.
`file` already quotes the paths it puts into its own commands, with POSIX single quotes (see
[Steps](./steps.md#file)). That helper could be the start of this tag, since `$.escape` targets Bun Shell, not POSIX
`sh`.

## Ordering between hosts

Out of scope for now: the Incus host and its containers are run as separate commands. It's worth reconsidering, because
the Incus host has to create a container before the container's own script can run, and a database host may need to be
up before an app host. The other tools split three ways:

- **Order of the command line.** `tsinfra apply incus sonarr --parallel 1` could run hosts in the order given. That
  needs no new concept, and `--fail-fast` (see [Ideas](./ideas.md#maybe-later)) would stop `sonarr` when `incus` fails.
- **Batches and serial runs,** like Ansible's `serial` and `order` and Salt's batch mode. These are for rolling a change
  through a fleet, which isn't the homelab's problem.
- **An orchestration layer,** like Salt's orchestrate runner, which runs states on one group of hosts, then another.
  That's a second language for the order of hosts.

A host-level `after`, where `sonarr` declares that it runs after `incus`, would be the smallest new concept if the
command line isn't enough. Decide with the Incus port.

## No state

tsinfra keeps no record of past runs. Every `plan` reads the machine as it is now. There is no state file to lose, lock,
or keep in sync, and any checkout on any control machine gives the same plan. Ansible and pyinfra work the same way.
Terraform needs state because it creates resources and has to know which ones are its own. tsinfra configures machines
that already exist.

What that costs:

- **Removing a step does not undo it.** A file or package the script stops managing stays on the machine. Removing it
  takes a step that removes it, like `check: "test -e /etc/sonarr.conf"` and `want: false`, with
  `fix: "sudo rm /etc/sonarr.conf"`.
- **`plan` cannot say why something differs.** A hand edit on the machine and an edit to the script look the same,
  because there is no record of the last apply.
- **Run-once work needs a marker.** A one-time migration has no natural check, so it leaves a marker on the host, like
  `test -f /var/lib/myapp/migrated`, and checks for that.

If removal becomes a real problem, there is a lighter fix than a state file. `file` records the paths it manages in a
manifest on the host (`~/.local/state/tsinfra/manifest`), and `plan` warns about paths in the manifest that the script
no longer manages. The machine stays the only source of truth. Revisit after porting real hosts. Lighter ways other
tools remove things without a state file are collected in [Ideas](./ideas.md#removed-resources).
