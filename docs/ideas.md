# Ideas

Features other tools have that could fit tsinfra, from a survey of pyinfra, Ansible, Salt, Chef, Puppet and Bolt,
cdist, Rex, Nix with home-manager and nix-darwin, mgmt, chezmoi, dotbot, yadm, Comtrya, Fabric, Pulumi, and Terraform
with OpenTofu, in November 2026. [Open questions](./open-questions.md) holds design questions that need an answer, and this file
holds candidate features. What got decided moved into the design, and Decided says where.

<!-- toc -->

- [Removed resources](#removed-resources)
- [Helper families](#helper-families)
- [Maybe later](#maybe-later)
- [Decided](#decided)
- [Rejected](#rejected)

<!-- tocstop -->

## Removed resources

The lowest priority here, and probably never built. A step the script stops managing leaves its file, link, or package
on the host, because there is no state file (see [No state](./open-questions.md#no-state)). tsinfra doesn't track this,
and the automatic approaches are in [Rejected](#rejected). What's left:

- **Turn a step into its removal instead of deleting it.** This is the recommended pattern, and it needs no new feature
  (see the recipes in `todo.md`). A step deleted without this leaves what it made on the host.
- **A manifest of `file` and `link` paths on the host,** from [No state](./open-questions.md#no-state), which only
  warns. A path is the one thing that identifies a step across edits, so this list can be accurate. It wouldn't cover
  anything done through `ensure`. Add it only if a port shows that forgotten files are a real problem.
- **A full set whose contents can be listed.** A helper can find the extras in a set the script declares completely.
  nix-darwin's Homebrew `cleanup` is `none`, `check`, `uninstall`, or `zap`, and Salt's `file.directory` with
  `clean: True` and chezmoi's `exact_` folders delete every entry the run didn't declare. A managed folder's `plan` must
  list every file it would delete.

## Helper families

Shipped as subpath exports once two hosts use one the same way (see
[Helpers worth shipping](./open-questions.md#helpers-worth-shipping)):

- **`tsinfra/files`:** a managed block between marker lines, like Ansible's `blockinfile`, Salt's `file.blockreplace`,
  and pyinfra's `files.block`. Maybe a single-line helper too, though Ansible itself warns against overusing
  `lineinfile`, and pyinfra's unanchored `files.line` match also catches `#foo` when you meant `foo`. Puppet's
  `file_line` has the cleanest options: `line`, `match`, `after`, and `multiple`.
- **`tsinfra/brew`:** a Brewfile written with `file`, an `ensure` on `brew bundle check --no-upgrade` with
  `HOMEBREW_NO_AUTO_UPDATE` set, and nix-darwin's cleanup modes. `plan` computes the extras itself, because
  `brew bundle cleanup` prompts.
- **`tsinfra/macos`:** each `defaults` key as an `ensure`, with `defaults read` as the check and `defaults write` as the
  fix, and a run that restarts Dock or Finder after. `defaults read` prints booleans as `1` and `0`. Like nix-darwin, a
  removed key stays as it was.
- **`tsinfra/docker`:** container helpers, starting with the empty-`want` `ensure` that keeps running containers on the
  newest images, if the Docker container ports repeat it.
- **A run-once marker,** like chezmoi's `run_once_`: write a hash of the command to
  `~/.local/state/tsinfra/once/<name>` on the host, and check for it.
- **A 1Password reader,** like chezmoi's `onepasswordRead`: run `op read` with Bun `$` on the control machine and pass
  the value to `file` with `secret`. Every `plan` has to read the secret to compare it, so every plan prompts.

## Maybe later

Opt-in features with no real case yet:

- **`tsinfra exec <host> -- <cmd>`** runs an ad-hoc command on a host's target without its script, like
  `pyinfra INVENTORY exec`.
- **`--fail-fast`** stops starting new hosts once one fails, like Ansible's `any_errors_fatal` and Salt's `failhard`.
  With `--parallel 1`, it works as a canary rollout.
- **`apply --confirm`** plans, prints the report, asks, then applies, like Terraform's `apply` prompt.
- **Retries on a fix,** like Ansible's `until`, Salt's `retry`, Chef's `retries`, and pyinfra's `_retries`. A `retry()`
  helper inside the fix may be enough.
- **`backup` on `link`,** for the first dotfiles run, where real files sit where the links go. home-manager's `-b`
  moves them aside and aborts if the backup already exists. If backups come back for `file`, Puppet's same-folder copy
  with an extension is the lightest model (see [Backups](./open-questions.md#backups-of-replaced-files)).
- **A `Secret` value type** that stays masked through string building, like Pulumi's secrets, without its full
  `Output<T>` model.
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
  already drops it, so the two can share that code. Until then, use `sudo`, or `sg <group> -c '...'`.
- **Log in with an SSH password,** like Ansible's `--ask-pass`. Today `BatchMode=yes` stops ssh from prompting, so a
  host that only takes a password fails in preflight with ssh's `Permission denied (publickey,password)`. ssh can ask a
  helper instead of the terminal, with `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4 and later), the same
  way sudo's askpass works. The helper runs on the control machine and prints a variable, so it holds no secret. Only
  the connection that opens the ControlMaster logs in, so a host needs the password once per run. It fits the sudo
  prompt's flow: `buildHostDetails` stops a host whose `Permission denied` lists `password`, then `finishHostDetails`
  prompts for it, opens the connection, and goes straight on to sudo, prompting for that too if needed. Each host's
  prompts come together, one host at a time. A key's passphrase would come through the same helper, and ssh's prompt
  text tells the two apart.
- **A manual step,** for work no command can do: pressing a pairing button, a login URL from `tailscale up`, an App
  Store sign-in for `mas`, or a macOS permission like Full Disk Access. It's shaped like `ensure` with instructions in
  place of a fix, like `h.manual(name, { check, want, instructions })`. `plan` shows the instructions under `~ change`.
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
  run in parallel. The cost is that these prompts come mid-run, not in preflight, so prompts from parallel hosts take
  turns and the live progress area pauses while one is open.

## Decided

Ideas moved into the design, with where they now live:

- **Validate a file before it replaces the old one,** from Ansible's `validate`, Salt's `check_cmd`, Chef's `verify`,
  and Puppet's `validate_cmd`. It's `file`'s `validate` option (see [Steps](./steps.md#the-write)), built as part 5 of
  `file` in `todo.md`.
- **Ask for the sudo password once,** from Ansible's `-K`, Fabric's `--prompt-for-sudo-password`, and pyinfra's
  `_sudo_password`. It became a preflight phase, `sudo` declared on `host()`, and a prompt per host (see
  [Transport](./transport.md#sudo)).
- **A reboot step,** from Ansible's `reboot` and pyinfra's `server.reboot`. It's `h.reboot({ after, timeout })`, which
  works like a run and checks the boot id changed (see [Steps](./steps.md#reboot)), under Later in `todo.md`.
- **Seed a file once,** from Chef's `:create_if_missing`. It's `file`'s `overwrite: false` (see
  [Steps](./steps.md#the-write)), built as part 7 of `file`.
- **SSH defaults for new hosts,** from pyinfra's `accept-new` default. tsinfra reads `ssh -G` and passes `accept-new`
  only over the default `ask`, and `ConnectTimeout=10` only when none is set (see
  [Transport](./transport.md#ssh-and-controlmaster)), built in the Transport step.
- **An idempotence check,** from Molecule and Test Kitchen: `apply`, then `plan` expecting exit 0, in the recipes in
  `todo.md`.
- **Lost triggers,** from Ansible's `force_handlers`. A run goes right after the steps it follows, and a failed
  triggered run's error says it needs a manual rerun (see [Steps](./steps.md#run)), as a follow-up in `todo.md`.
- **Versioned JSON,** from Terraform's machine-readable output. Readers ignore unknown fields and refuse an unsupported
  major version, folded into [JSON output](./open-questions.md#json-output).
- **Verbosity levels,** from pyinfra's `-vv` and `-vvv`. `-vv` lists commands, labeling tsinfra's own, and `-vvv` adds
  their output (see [CLI](./cli.md#output)), next in `todo.md`.

## Rejected

Recorded so the survey doesn't need redoing:

- **A run that reports nothing changed,** like Ansible's `changed_when` and Salt's `stateful` scripts, as a run function
  returning `{ changed: false }`. Its case, pulling images and recreating containers only when one is new, is an
  `ensure` on "the running containers are on the newest images", with a read-only check and an empty `want` (see the
  recipes in `todo.md`). The run version only made sense because it let the pull sit where a read-only check belongs,
  and its `plan` showed a change every time.

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

- **A directory step,** like `h.dir(path, { mode })` and the directory modes in pyinfra's `put_files`. `file` exists
  because of its data: sending the content, hashing it, diffing it, and swapping it in atomically. A directory has no
  data, so an `ensure` covers it, including its mode and owner (see the recipes in `todo.md`). A helper can handle what
  differs on macOS and quote the path.

- **Tags, targeting, and `--start-at-task`.** Tags are a non-goal, and idempotent steps make starting partway pointless.
- **`block`/`rescue`, `ignore_errors`, and continuing past a failure.** A failed host stays failed, and `inspect`
  handles an exit that isn't an error.
- **State-file features:** saved plans, `moved` blocks, refresh-only, generations, and rollback. Rollback is a git revert
  and an `apply`.
- **Guards like `only_if`, `not_if`, `creates`, and `unless`.** `ensure`'s check covers them, and Chef's own docs show
  guards make why-run inaccurate.
- **Delegation and `local_action`.** The script already runs on the control machine.
- **Plugin systems for output.** JSON output covers what a reader needs.
- **Fact caching and fact systems.** See [Fact helpers](./open-questions.md#fact-helpers).
- **Vaults and encrypted files in the repo.** TypeScript can call sops or a password manager directly.
- **Reading every step's state before any fix,** like cdist's stages and pyinfra's prepare phase. It decides on state
  that's stale by the time the fix runs.
- **Delayed, deduplicated notifications.** A run after both steps with `after: [a, b]` already fires once.
- **Async tasks.** They have no check mode, and SSH keepalives cover long commands.
- **Real-time watching,** like mgmt. A daemon is the full config tool tsinfra isn't.
- **Second languages for plans,** like Bolt's YAML plans and cdist's file-per-parameter types.
