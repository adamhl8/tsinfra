# CLI

<!-- toc -->

- [Hosts](#hosts)
  - [Tasks](#tasks)
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
is the name used on the command line. The file's default export is `host(target, fn, options?)`. Shared setup lives anywhere
else and is imported like any other module.

With no host names, `plan` and `apply` run every host. An unknown name is an error that lists the names that exist.

### Tasks

A host can have named tasks besides its main function, for work you run on demand, like updates. Configuring a host and
updating it use the same steps, but an update shouldn't happen every time the configuration changes:

```ts
const update = task("update", async (h) => {
  await h.ensure("Upgrade packages", {
    check: "sudo apt-get update && apt list --upgradable | tail -n +2",
    want: "",
    fix: "sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
  })
})

export default host("sonarr.lan", configure, { sudo: true, tasks: [update] })
```

```sh
tsinfra plan sonarr                # the main function
tsinfra plan sonarr --task update  # only the update task
tsinfra plan --task update         # every host that has an update task, and no others
```

- **A task is an ordinary host function,** with the same `h`, steps, `plan`, `apply`, session, and sudo prompt. With
  an empty `want`, `plan --task update` lists what would upgrade on every host.
- **`task(name, fn)` mirrors `host(target, fn)`,** and `host()` registers its tasks explicitly with `tasks`, so a task
  only belongs to the hosts that list it. A task exported from a shared module doesn't register itself anywhere.
- **Define a task above the `host()` call,** because `host()` reads `tasks` straight away, and a `const` can't be read
  before its line.
- **Task names are unique within a host.**
- **It isn't tags.** Tags pick steps inside one script. A task is a separate function, so each one still reads top to
  bottom.

## plan and apply

- **`plan`** reads the host's state for every step and runs no fix. See [Steps](./steps.md).
- **`apply`** reads the host's state for every step and runs every needed fix, in order, with no confirmation prompt. Run `plan` first to see
  what will happen. That is the workflow `~/homelab/justfile` already uses, with `apply` passing `-y` to pyinfra.

Hosts run in parallel, up to `--parallel <n>` at once (default 8). Steps within a host always run one at a time, in
order. A step that starts while another is running fails the host (see [Steps](./steps.md#commands)).

## Output

Each host's output is held until that host finishes, then printed as one block, so lines from different hosts never
mix. A summary follows.

By default a block lists only the steps that changed, would change, are waiting, or failed. `--verbose` (`-v`) adds the
rest: steps that were already right as `=` lines, and each read or inspect as a `·` line named by its command. With
`--verbose`, a host whose script made no steps still gets a block, with "no steps" under its name, so it's clear the
host ran.

Two more levels show the commands behind each step, following the `-v`, `-vv`, `-vvv` convention of pyinfra, Ansible,
and ssh. Every command is already recorded with its output (see [What a host records](#what-a-host-records)), so these
only change what's printed:

- **`-vv`** also lists each command a step ran, dimmed, under the step, like `$ systemctl is-active sonarr`. Commands
  tsinfra writes itself, like `file`'s multi-line details script, show as a short label, like
  `$ (file details script)`. The exact labels get settled when this is built. A command that `sudo: true` ran as root
  gets a tag, and never shows the `sudo sh -s` around it. The tag's look gets settled at the same time.
- **`-vvv`** also shows each command's exit code, stdout, and stderr, indented under it and cut off after some number
  of lines, and tsinfra's own commands in full.
- **Secrets never show.** A `secret` command keeps its text and output out of the record, and `shell.inspect` records
  every command, so it's the one place to enforce that. The sudo preamble is added below the recorder, so it's never
  recorded at all.
- **A failure doesn't need them.** A failed step's error already names the command that failed and its stderr.

```
sonarr
  ~ change:    (file) /etc/systemd/system/sonarr.service
      -Restart=always
      +Restart=on-failure
  > triggered: (run)  Reload systemd

immich
  ! failed: (ensure) Start Immich
      docker is missing: launch the container with the docker profile

macbook
  ~ change:  (ensure) Install brew packages
  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'

Steps after a change were checked without that change, so apply may differ.

caddy     unchanged
immich    failed
macbook   1 change, 1 waiting
sonarr    2 changes
```

Each line names its status in words after the symbol. A status reads the same in `plan` and `apply`, because `plan`
never changes anything the script manages, so its words have no tense, and a line needs no "would". The exact format is
open: see [Open questions](./open-questions.md).

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
- **Step lines.** A line starts with the step's status, as a symbol and a word in the status's color, then an uncolored colon, like `~ change:`.
  Then comes the step's kind in dim parentheses, like `(file)`, and then its name. The status and the kind are each
  padded to the widest in the block, so every kind and every name starts in one column. The parentheses keep the kind
  apart from the name without color. A failure no step owns shows `(host)` in place of a kind, also in italics, so it
  doesn't read as a kind of step. That's a failure of the host's script, or a host that couldn't be prepared. A `changed` step from `ensure`, `file`, or `link` is `~ change`, and a `ran` step from `run` is
  `> triggered`, because a step it follows changed. Any failed step is `! failed`, because the status matters more than the kind once
  something broke, and the error already says what failed. In `--verbose`, every step that was already right is `= unchanged`,
  whatever its kind, so it doesn't rely on color to tell it from a change. A run whose trigger didn't fire is `= unchanged` too,
  because nothing needed doing. A read or inspect has its own `observed` status, so it gets a gray `· observed` rather than `=`.
- **Failures.** A failed step shows its error's message chain on indented lines under it, in bright red, so it stands
  apart from a red `got:` value. Its `!` and the host's `failed` in the summary are bright red too. That includes a
  failure the script caught inside the step, because the step still fails. The details a step found, like `got:` and
  `want:`, are indented further and are not red, because they are not the error. A failure that is not any step's, like
  the script throwing, is the block's last `!` line, named after the host's script in italics (like `sonarr.ts`), so it
  doesn't read as a step, with its error under it the same way. The block's header already names the host, so the error
  is not wrapped in "failed to run host". A host that couldn't be prepared, like an unreachable one, never ran its
  script, so its block has one `!` line named after its target (like `web.lan`), with an error that starts with
  "failed to prepare the host".
- **Failure details.** A failure that still differs after its fix shows its `after` values, then any stderr that can
  explain it, from its `fix` and `after` phases. A phase that ran one command, which wrote to stderr, gets a
  `stderr: <command> -> <stderr>` row. It's clear what that stderr relates to, because that command is all the phase ran.
  A phase that ran several commands, any of which wrote to stderr, can't say which one matters, so it gets a note
  instead: "some commands during the fix wrote to stderr, run with -vvv to see them", or "after the fix" for the `after`
  phase. Commands tsinfra wrote itself never count. The `before` phase never shows here, because it ran before the fix,
  so it can't explain the state after it. A failed fix, or a compare after the fix that failed, shows only its error,
  which already holds its stderr. `--verbose` adds the values from before the fix under a "values before the fix" note,
  which is there because they may no longer be true.
- **Values** are cyan when they came from the script or the host, like the command in a `stderr:` row and the command a
  read or inspect is named by. The stderr in that row is bright red like an error, so it stands apart from its command. That sets them apart from tsinfra's own words. A `got:` value is red and a `want:` value is green, like a
  diff's `-` and `+` lines. A string value keeps its quotes, so an empty one still shows without color, but the quotes
  stay uncolored, so they don't read as part of the value. An exit code is also italic, because it isn't quoted. A
  multi-line value's later lines line up under its first line's text. The labels, like `got:`, are dim, so the values
  stand out.
- **Colors** follow the status: a summary's change count matches `~` and `>`, and its waiting count matches `?`. The
  plan reminder is dim, so the host lines stay the main thing in the summary. In a block, the notes of waiting steps
  line up in one column.
- **Warnings.** A step that worked but needs a look, like a link to a missing path, gets a `warning:` line under its
  details, with the label in bright yellow, so it stands apart from the plain yellow of a change. A warning makes its
  step show even when it was already right, without `--verbose`. The report decides what's a warning from the facts
  in the record, so no step records words. A failed step gets none, because its error is what needs fixing first. A
  warning isn't drift, so it doesn't change the exit code.
- **A host with nothing to show** gets no block, only its line in the summary.
- **The summary** has one line per host: `unchanged`, `failed`, or a count of changes, where a count includes both
  `changed` and `ran` steps, so it matches the `~` lines in the blocks. A count of warnings follows, like
  `unchanged, 1 warning`, so one isn't lost once the blocks have scrolled away. In `plan`, when any step's state differed, it
  starts with the reminder that steps after a change were checked without it (see
  [Steps](./steps.md#what-plan-can-and-cannot-show)).
- **Diffs** come from jsdiff (the `diff` package), not hand-written code. It is the standard line-diff library for
  JavaScript, has no dependencies, and returns hunks with context as data, which the report colors itself. A step that
  would change a string shows how under its line: `got:` and `want:` for a single-line value, or a diff for a multi-line
  one. A diff shows 1 unchanged line around each change. Each line is numbered by where it sits in `want`, so a removed
  line, which isn't in `want`, has no number, the way Zed shows a combined diff. A dim rule separates the hunks, and
  another frames the diff above and below, so it stands apart from a `stderr:` row or a `mode:` row after it. A
  boolean or an exit code shows nothing, because the step's name says what yes and no mean. A diff longer than 15 lines,
  counting the rules between hunks, shows "long diff (N lines)" instead. A diff that takes longer than 200 ms to compute shows "diff took
  too long to compute". Both suggest `--verbose`, which shows every diff in full and allows 10 seconds to compute one.

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

- **A step** records its kind (`read`, `inspect`, `ensure`, `run`, `file`, or `link`), its name, its status, and its error if it
  failed. A read or inspect has no name, so it records its command.
- **A step's commands** are every command that ran while it was running, including those from reading its state and from its fix
  functions. A read or inspect has exactly one.
- **A command** records the command, its stdout and stderr, and its exit code. A command that could not run at all
  records the error instead. A command tsinfra wrote itself also records a short label, like `file details script`.
  A command in a step that compares the host's state records its phase: `before`, `fix`, or `after`.
- **A step's comparisons** are what it found each time it compared the host with what it wants: a `before` comparison,
  and an `after` comparison when it compared again after the fix. Each holds the values it compared and whether they
  matched.
- **A waiting step** records the names of the needed steps it waited on.

A step never records anything itself. It returns its one status, or an error, and the record gets everything else from
the wrappers the step runs through: the shell's transport records commands, and `converge` records comparisons. So a
failure keeps what the step found before it.

A step's status is `unchanged`, `changed`, `ran`, `waiting`, or `observed`. `changed` means the host's state differed.
`ran` means a run's trigger fired, or its `after` was `"always"`. `waiting` means a step it needs would change. A read
or inspect is always `observed`. The record is the same in `plan` and `apply`, and so is each step's line. A changed
step's details come from its `before` comparison, so `apply` can show what a step changed too.

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

|         | `0`      | `1`             | `2`      |
| ------- | -------- | --------------- | -------- |
| `plan`  | no drift | any host failed | drift    |
| `apply` | success  | any host failed | not used |

`plan` exiting 2 makes a drift check in CI or a cron job a one-liner. `apply` never exits 2, because a run that changed
things succeeded.

`plan` exits 2 on drift: a step that reads the host's state found it different from the script, which is a `changed`
status. A `run` shows up in the plan as a `>` line and counts as a change in the summary, but it is never drift, because
it doesn't read the host's state. See [Steps](./steps.md#run).

A failed host wins. `plan` exits 1 when any host failed, even if another host has drift, because the plan for
the failed host is incomplete.
