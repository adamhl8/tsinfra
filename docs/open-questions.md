# Open questions

What still needs an answer. Most are best settled by porting real hosts first (see `todo.md`).

<!-- toc -->

- [What `plan` output should look like](#what-plan-output-should-look-like)
- [Interactive sudo](#interactive-sudo)
- [Interactive commands](#interactive-commands)
- [Published, or personal](#published-or-personal)
- [Helpers worth shipping](#helpers-worth-shipping)
- [A directory step](#a-directory-step)
- [A fix that runs local code](#a-fix-that-runs-local-code)
- [Ordering between hosts](#ordering-between-hosts)
- [No state](#no-state)

<!-- tocstop -->

## What `plan` output should look like

[CLI](./cli.md#output) has a first guess. The evidence so far is `~/homelab/justfile`, whose `plan` recipe filters
pyinfra's JSON down to just the names of pending changes. That suggests the default should be terse, with diffs. Settle
it by running `plan` on the ported Mac and reacting to what it shows.

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

## A fix that runs local code

`fix` is shell only. A fix that needs work on the control machine at apply time (download locally, then upload) has to
do that work before the step today, which means doing it during `plan` too. Revisit if a port hits this.

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
