# CLI

<!-- toc -->

- [Hosts](#hosts)
- [plan and apply](#plan-and-apply)
- [Output](#output)
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
order.

## Output

Each host's output is held until that host finishes, then printed as one block, so lines from different hosts never
mix. A summary follows.

By default a block lists only the steps that changed, would change, are waiting, or failed. `--verbose` adds steps that
were already right, with their `noop` message, and steps skipped after a failure.

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

## Exit codes

|         | `0`        | `1`             | `2`             |
| ------- | ---------- | --------------- | --------------- |
| `plan`  | no changes | any host failed | changes pending |
| `apply` | success    | any host failed | not used        |

`plan` exiting 2 makes a drift check in CI or a cron job a one-liner. `apply` never exits 2, because a run that changed
things succeeded.
