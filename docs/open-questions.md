# Open questions

What still needs an answer. Most are best settled by porting real hosts first (see `todo.md`).

<!-- toc -->

- [What `plan` output should look like](#what-plan-output-should-look-like)
- [Interactive sudo](#interactive-sudo)
- [Published, or personal](#published-or-personal)
- [Helpers worth shipping](#helpers-worth-shipping)
- [A directory step](#a-directory-step)
- [A fix that runs local code](#a-fix-that-runs-local-code)
- [Ordering between hosts](#ordering-between-hosts)

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
