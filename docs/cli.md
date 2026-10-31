# CLI

<!-- toc -->

- [Hosts](#hosts)
- [plan and apply](#plan-and-apply)
- [Output](#output)
  - [What a host records](#what-a-host-records)
- [Exit codes](#exit-codes)

<!-- tocstop -->

```sh
tsinfra plan                  # every host in ./hosts
tsinfra plan sonarr caddy     # just these
tsinfra apply sonarr
tsinfra apply sonarr --verbose
```

## Hosts

The CLI looks in `./hosts` (or `--hosts-dir <dir>`). Each `.ts` file there is one host, and its file name without `.ts`
is the name used on the command line. The file's default export is `host(target, fn)`. Shared setup lives anywhere
else and is imported like any other module.

With no host names, `plan` and `apply` run every host. An unknown name is an error that lists the names that exist.

## plan and apply

- **`plan`** runs every check and no fix. See [Steps](./steps.md).
- **`apply`** runs every check and every needed fix, in order, with no confirmation prompt. Run `plan` first to see
  what will happen. That is the workflow `~/homelab/justfile` already uses, with `apply` passing `-y` to pyinfra.

Hosts run in parallel, up to `--parallel <n>` at once (default 8). Steps within a host always run one at a time, in
order. A step that starts while another is running fails the host (see [Steps](./steps.md#commands)).

## Output

Each host's output is held until that host finishes, then printed as one block, so lines from different hosts never
mix. A summary follows.

By default a block lists only the steps that changed, would change, are waiting, or failed. `--verbose` adds steps that
were already right, with their `noop` message.

```
sonarr
  ~ Write /etc/systemd/system/sonarr.service
      -Restart=always
      +Restart=on-failure
  ~ Reload systemd                        would run

immich
  ! Start Immich                          docker is missing: launch the container with the docker profile

macbook
  ~ Install brew packages
  ? Make fish the login shell             waits on "Install brew packages"

Later steps were checked against the current state.

caddy     ok
immich    failed
macbook   1 change, 1 waiting
sonarr    2 changes
```

`~` is a change, `?` is waiting, `!` is a failure, and `=` (verbose only) is already right. The exact format is open:
see [Open questions](./open-questions.md).

### What a host records

The output is built from a record of each host's run. It is one list of steps and commands, in the order the script
called them.

- **A step** records its name, its kind (`ensure`, `ensureValue`, `run`, or `file`), whether it changed, and its error
  if it failed. An `ensureValue` that differed also records the read and want values.
- **A step's commands** are every command that ran while it was running, including those from its check, read, and fix
  functions.
- **A command** records the command, its stdout and stderr, and its exit code. A command that could not run at all
  records the error instead.
- **A command outside any step,** like a top-level `h.read`, sits in the list between the steps.

The record is the same in `plan` and `apply`. `changed` means the check did not pass, or a run's `when` was true. The CLI
knows the mode, so it shows that as "would change" or "would run" in `plan`. The read and want values come from the
check before the fix, so `apply` can show what a step changed too.

A failed step records its error. Steps called after the host failed throw without running, so they are not recorded. A
failure that is not a step's, like a bug in the script, is the host's own failure.

## Exit codes

|         | `0`        | `1`             | `2`             |
| ------- | ---------- | --------------- | --------------- |
| `plan`  | no changes | any host failed | changes pending |
| `apply` | success    | any host failed | not used        |

`plan` exiting 2 makes a drift check in CI or a cron job a one-liner. `apply` never exits 2, because a run that changed
things succeeded.

Only steps with a check decide whether `plan` exits 2. A `run` shows up in the plan as "would run" but never counts,
because it has no check. See [Steps](./steps.md#run).
