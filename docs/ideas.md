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

To come back to. A step the script stops managing leaves its file, link, or package on the host, because there is no
state file (see [No state](./open-questions.md#no-state)). The tools that remove safely without one learn what they own
from the host itself or from the current run:

- **Explicit removal stays an `ensure`,** like `check: "test -e /etc/x || test -L /etc/x"`, `want: false`. An absent
  form was rejected (see [Rejected](#rejected)).
- **Links prove their owner.** A symlink into the repo is tsinfra's, so orphans can be found and removed. This came up
  as a `pruneLinks(dir, repo)` step and was deferred to be decided with the rest of removal, so it might just happen
  automatically. The rule it would follow:
  - The session records each `link` step's path during the run, in memory only.
  - A symlink under the folder whose target is in the repo, and whose path no `link` step declared, is an orphan. It
    doesn't matter whether its target exists. Renaming a repo file and its `link` step leaves the old link dead and
    undeclared, so it goes.
  - A declared link with a missing target stays, because its `link` step owns it and shows `points to a missing path`.
  - Links that point outside the repo are never touched.
  - A `link` inside the folder that runs after the prune fails the host, because the prune would have deleted it.
  - home-manager deletes only links into its own generations, and dotbot's `clean` removes dead links into the
    dotfiles folder.
- **Fully managed folders.** Salt's `file.directory` with `clean: True` and chezmoi's `exact_` folders delete every
  entry the run didn't declare. That suits a folder like fish's `functions/`, but `plan` must list every file it would
  delete. It overlaps the [directory step](./open-questions.md#a-directory-step).
- **A declared full list.** When the script declares everything, like a Brewfile, the extras are what's installed minus
  what's declared. nix-darwin's Homebrew `cleanup` is `none`, `check`, `uninstall`, or `zap`.
- **A manifest on the host,** from [No state](./open-questions.md#no-state), as the heavier fallback.

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
  balancer before a deploy.

## Decided

Ideas moved into the design, with where they now live:

- **Validate a file before it replaces the old one,** from Ansible's `validate`, Salt's `check_cmd`, Chef's `verify`,
  and Puppet's `validate_cmd`. It's `file`'s `validate` option (see [Steps](./steps.md#the-write)), built as part 5 of
  `file` in `todo.md`.
- **Ask for the sudo password once,** from Ansible's `-K`, Fabric's `--prompt-for-sudo-password`, and pyinfra's
  `_sudo_password`. It became a preflight phase, `sudo` declared on `host()`, and a prompt per host (see
  [Transport](./transport.md#sudo)).
- **A reboot step,** from Ansible's `reboot` and pyinfra's `server.reboot`. It's `h.reboot({ after, timeout })`, which
  works like a run and checks the boot id changed (see [Steps](./steps.md#reboot)), built as step 6 in `todo.md`.
- **Seed a file once,** from Puppet's and Salt's `replace: false`. It's `file`'s `overwrite: false` (see
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
  their output (see [CLI](./cli.md#output)), under Later in `todo.md`.

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
