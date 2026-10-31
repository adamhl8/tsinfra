# Open questions

What still needs an answer. Most are best settled by porting real hosts first (see `todo.md`).

<!-- toc -->

- [What `plan` output should look like](#what-plan-output-should-look-like)
- [Showing what commands printed](#showing-what-commands-printed)
- [Interactive sudo](#interactive-sudo)
- [Interactive commands](#interactive-commands)
- [Published, or personal](#published-or-personal)
- [Helpers worth shipping](#helpers-worth-shipping)
- [A directory step](#a-directory-step)
- [Sending data to a command](#sending-data-to-a-command)
- [How `file` sends content](#how-file-sends-content)
- [Rebooting a host](#rebooting-a-host)
- [Steps side by side within a host](#steps-side-by-side-within-a-host)
- [Quoting values in commands](#quoting-values-in-commands)
- [Ordering between hosts](#ordering-between-hosts)
- [No state](#no-state)

<!-- tocstop -->

## What `plan` output should look like

[CLI](./cli.md#output) has a first guess. The evidence so far is `~/homelab/justfile`, whose `plan` recipe filters
pyinfra's JSON down to just the names of pending changes. That suggests the default should be terse, with diffs. Settle
it by running `plan` on the ported Mac and reacting to what it shows.

## Showing what commands printed

Every command is recorded with its stdout, stderr, and exit code, under the step that ran it (see
[CLI](./cli.md#what-a-host-records)). The default output shows none of it. What is open is how much to show, and when.
`--verbose` could print each step's commands, and a failure could show the commands of the step that failed.

A `secret` command must leave its command text and output out of the record. `shell.inspect` records every command, so
it is the one place to enforce that.

## Interactive sudo

`sudo -n` never prompts, so v1 needs passwordless sudo. Two hosts do not have it:

- **The Mac.** Making fish the login shell runs `chsh` as root.
- **The Incus host on its first run.** The homelab todo says the first run escalates with the password from sops,
  because passwordless sudo is deliberately not in the preseed.

Options include running `sudo -v` interactively before a host starts (fine for the local host, awkward with hosts in
parallel), or passing a password on stdin to `sudo -S` from a secret the script decrypted.

## Interactive commands

Some commands need a person at the keyboard, like an installer that asks questions. Commands normally run with their
script on stdin and their output captured, so nothing can answer a prompt.

Two ways to allow it:

- **Inherit the terminal.** Connect the command to the CLI's own terminal (`stdio: "inherit"` locally, `ssh -t`
  remotely). The user answers prompts directly, and tsinfra sees none of the output.
- **A pseudo-terminal.** `Bun.spawn`'s `terminal` option attaches a PTY, so tsinfra sits between the command and the
  user. It can show and record the output, or answer a prompt itself, like a sudo password from a decrypted secret (see
  [Interactive sudo](#interactive-sudo)).

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

How the data travels should follow [how `file` sends content](#how-file-sends-content). Add it when a port needs it.

## How `file` sends content

[Transport](./transport.md#file-writes) sends file content inside the write script, base64-encoded in a heredoc. That
needs no SFTP, keeps secrets off the command line, and writes as root under `sudo -n sh -s`. The shell parses the whole
script before it runs, so a large file sits in the shell's memory before the write starts. Base64 also adds a third to
every transfer. `scp` or SFTP is the obvious alternative, though writing a root-owned file through it takes a second
command. Revisit before building `file`.

## Rebooting a host

Some changes need a reboot, like a kernel update. Running `reboot` with `exec` drops the connection, so the command looks
like it failed, and nothing waits for the host to come back. A reboot needs its own support: run it, wait for the
transport to reconnect, then carry on with the rest of the script. In `plan` nothing reboots, so later steps are checked
against the current state, like any step after a would-change step. Add it when a port needs it.

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

## Ordering between hosts

Out of scope: the Incus host and its containers are run as separate commands. Revisit if that becomes a real source of
mistakes.

## No state

tsinfra keeps no record of past runs. Every `plan` reads the machine as it is now. There is no state file to lose, lock,
or keep in sync, and any checkout on any control machine gives the same plan. Ansible and pyinfra work the same way.
Terraform needs state because it creates resources and has to know which ones are its own. tsinfra configures machines
that already exist.

What that costs:

- **Removing a step does not undo it.** A file or package the script stops managing stays on the machine. Removing it
  takes a step that removes it, like `check: "! test -e /etc/sonarr.conf"` with `fix: "sudo rm /etc/sonarr.conf"`.
- **`plan` cannot say why something differs.** A hand edit on the machine and an edit to the script look the same,
  because there is no record of the last apply.
- **Run-once work needs a marker.** A one-time migration has no natural check, so it leaves a marker on the target, like
  `test -f /var/lib/myapp/migrated`, and checks for that.

If removal becomes a real problem, there is a lighter fix than a state file. `file` records the paths it manages in a
manifest on the target (`~/.local/state/tsinfra/manifest`), and `plan` warns about paths in the manifest that the script
no longer manages. The machine stays the only source of truth. Revisit after porting real hosts.
