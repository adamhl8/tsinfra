# CLI

<!-- toc -->

- [Hosts](#hosts)
- [plan and apply](#plan-and-apply)
- [Output](#output)
  - [How the report is built](#how-the-report-is-built)
  - [Live progress](#live-progress)
  - [What a host records](#what-a-host-records)
  - [Diagnostic logs](#diagnostic-logs)
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
were already right, as `=` lines.

```
sonarr
  ~ Write /etc/systemd/system/sonarr.service
      -Restart=always
      +Restart=on-failure
  > Reload systemd

immich
  ! Start Immich
      docker is missing: launch the container with the docker profile

macbook
  ~ Install brew packages
  ? Install fish plugins   waits on 'Install brew packages'

Steps after a change were checked without that change, so apply may differ.

caddy     ok
immich    failed
macbook   1 change, 1 waiting
sonarr    2 changes
```

`~` is a change, `>` is a run, `?` is waiting, `!` is a failure, and `=` (verbose only) is already right. A step's
symbol is the same in `plan` and `apply`, because `plan` never changes the target, so a line needs no "would". The exact
format is open: see [Open questions](./open-questions.md).

### How the report is built

The output is a report, not a log. tsinfra renders it from each host's [record](#what-a-host-records) with its own small
formatting functions, because no library draws this layout. A logging library formats one event per line, with a level
and a timestamp, and would not help with blocks, aligned columns, or diffs.

- **Streams.** The whole report goes to stdout, failures included. stderr is only for tsinfra's own errors: a usage
  error, or hosts that can't be discovered or loaded. Those print through Optique's `printError`, so they look like the
  parser's own errors. They happen before any host runs, so they never mix with a report. A theme passed to both
  `run()` and `printError` makes the `Error:` label red and bold. Optique colors stderr only when it is a terminal.
- **Colors** come from [picocolors](https://github.com/alexeyraspopov/picocolors). It follows `NO_COLOR`,
  `FORCE_COLOR`, and `--no-color`, and prints plain text when stdout is not a terminal. `util.styleText` from `node:util`
  does the same, but its behavior depends on each runtime's `node:util`, and picocolors' rules are its own. Tests set
  `NO_COLOR` in the test preload, before anything imports picocolors.
- **Step lines.** The symbol names what kind of step it was. A `changed` step from `ensure` or `file` is `~`,
  and a `ran` step from `run` is `>`. Any failed step is `!`, because the status matters more than the kind once
  something broke, and the error already says what failed. In `--verbose`, every step that was already right is `=`,
  whatever its kind, so it doesn't rely on color to tell it from a change.
- **Failures.** A failed step shows its error's message chain on indented lines under it, in red. That includes a
  failure the script caught inside the step, because the step still fails. The facts a check found, like `got:` and
  `want:`, are indented further and stay plain, because they are not the error. A failure that is not any step's, like
  the script throwing, is the block's last `!` line, named after the host's file (like `sonarr.ts`), with its error
  under it the same way. The block's header already names the host, so the error is not wrapped in "failed to run host".
- **A host with nothing to show** gets no block, only its line in the summary.
- **The summary** has one line per host: `ok`, `failed`, or a count of changes, where a count includes both `changed`
  and `ran` steps, so it matches the `~` lines in the blocks. In `plan`, when any check did not pass, it starts with
  the reminder that steps after a change were checked without it (see
  [Steps](./steps.md#what-plan-can-and-cannot-show)).
- **Diffs** come from a diff library, not hand-written code. Which one is open (see
  [Open questions](./open-questions.md#choosing-a-diff-library)).

A `--json` mode that writes the report as data is a later addition (see
[Open questions](./open-questions.md#json-output)).

### Live progress

While hosts run, the output shows what tsinfra is doing, and each host's progress turns into its report when it
finishes:

- **A live line per running host,** with a spinner and the step it is on. The current step comes from the host's
  record, because a step's record is pushed when the step starts.
- **A permanent block per finished host.** When a host finishes, its live line goes away and its block prints above the
  live area, where it stays. The block is the same text `formatHostBlock` produces, so the live view and the report never
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

Live progress comes with the SSH transport and `--parallel`, because that is when hosts are slow enough, and run at once,
for progress to matter. Until then the blocks print directly as each host finishes. The details still open are in
[Open questions](./open-questions.md#live-progress-details).

### What a host records

The output is built from a record of each host's run. It is one list of steps, in the order the script called them.

- **A step** records its kind (`read`, `inspect`, `ensure`, `run`, or `file`), its name, its status, and its error if it
  failed. A read or inspect has no name, so it records its command. An `ensure` with a string `want` that differed also
  records the `got` and `want` values.
- **A step's commands** are every command that ran while it was running, including those from its check and fix
  functions. A read or inspect has exactly one.
- **A command** records the command, its stdout and stderr, and its exit code. A command that could not run at all
  records the error instead.

A step's status is `ok`, `changed`, or `ran`. `changed` means its check did not pass. `ran` means a run's trigger fired,
or it was `always`. A read or inspect is always `ok`. The record is the same in `plan` and `apply`, and so is each
step's line. The output and `want` come from the check before the fix, so `apply` can show what a step changed too.

A failed step records its error. Steps called after the host failed throw without running, so they are not recorded. A
failure that is not a step's, like a bug in the script, is the host's own failure.

### Diagnostic logs

Logs are separate from the report. They are for working out what tsinfra itself did, like which SSH command it ran, how
long a connection took, or why it failed. They use [LogTape](https://logtape.org) and go to stderr, so stdout stays the
report.

- **LogTape** has no dependencies and supports Bun. It stays silent until the application configures it, which matters
  because host scripts import tsinfra as a library. It ships a JSON Lines formatter, and `@logtape/pretty` for readable
  terminal output.
- **`@optique/logtape`** adds the logging options to the existing Optique parser, like `-v`/`-vv` or `--log-level`, and
  `--log-output`.

Nothing logs yet. Add LogTape with the SSH transport, which is the first code worth diagnosing.

## Exit codes

|         | `0`        | `1`             | `2`             |
| ------- | ---------- | --------------- | --------------- |
| `plan`  | no changes | any host failed | changes pending |
| `apply` | success    | any host failed | not used        |

`plan` exiting 2 makes a drift check in CI or a cron job a one-liner. `apply` never exits 2, because a run that changed
things succeeded.

Only steps with a check decide whether `plan` exits 2, because only a `changed` status counts. A `run` shows up in the
plan as a `>` line but never counts, because it has no check. See [Steps](./steps.md#run).

A failed host wins. `plan` exits 1 when any host failed, even if another host has changes pending, because the plan for
the failed host is incomplete.
