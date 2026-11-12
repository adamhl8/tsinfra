# CLI

<!-- toc -->

- [Hosts](#hosts)
  - [Tasks](#tasks)
- [plan and apply](#plan-and-apply)
- [Output](#output)
  - [How the report is built](#how-the-report-is-built)
  - [Live progress](#live-progress)
  - [What a host records](#what-a-host-records)
  - [Kinds of failure](#kinds-of-failure)
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

By default a block lists only the steps that changed, would change, are waiting, or failed. A host whose script made
no steps still gets a block, with "no steps" under its name, so it's clear the host ran.

Three levels of `-v` show more, following the `-v`, `-vv`, `-vvv` convention of pyinfra, Ansible, and ssh. Each level
shows everything the one before it does. `-vvv`, `-v -v`, and `--verbose -vv` all count, and more than three count as
three. Every command is already recorded with its output (see [What a host records](#what-a-host-records)), so the
levels only change what's printed:

- **`-v`** (`--verbose`) adds the rest of the steps: steps that were already right as `=` lines, and each read or
  inspect as a `·` line named by its command. It also shows every diff in full, and a failed fix's values from before
  the fix. A step given options that change how its commands run gets an `options:` line under it, naming the ones it
  set, like `options: sudo` or `options: env { URL, PORT }, secretEnv { TOKEN }`. It names each variable but shows no
  value, because the values come at `-vv`. A `sudo` the script writes inside a command doesn't count, because it shows
  in the command at `-vv`.
- **`-vv`** also turns the `options:` line into a block, with each variable on its own row and its value, and each
  `secretEnv` value as `[MASKED]`. The values line up within each of `env` and `secretEnv`, not across them, because
  each is its own object. It lists each command a step ran, dimmed, under a `commands:` heading after the step's other
  details, like `$ systemctl is-active sonarr`, in the order they ran. A read or inspect lists none, because its name
  is its command. A command tsinfra writes itself shows as its label in angle brackets, like
  `$ <file details script>`, because its text is tsinfra's code, not the script's. Angle brackets mark text that isn't
  shown, as the record's `<content as base64>` does. A command's later lines line up under its first line's text. On a
  failed step, the commands come after what it found and before any hint. A `file` step's `validate` command shows in
  its options, not after the write script's label, so it shows in `plan` too. A step's commands never show the
  `sudo sh -s` that
  `sudo: true` wraps them in. A preparation failure lists the commands preparation ran, by their labels, like
  `$ <home directory>`, so it shows how far preparation got. A host that was prepared lists none, because the same
  commands would repeat in every block.
- **`-vvv`** also shows what each command printed, as `exit:`, `stdout:`, and `stderr:` rows under it, lined up like a
  step's other details. A read or inspect, which lists no command, shows its rows right under its line. Every command
  shows its exit code, even 0, and a command that couldn't run at all shows its error in place of the three rows.
  stdout and stderr are each cut off after 20 lines, with a note saying how many lines were left out. In a step that
  compares the host's state, each command starts with its phase, `before`, `fix`, or `after`, because the same check
  runs before and after the fix, and its output can differ. tsinfra's own commands keep their label, so their text
  never shows. It's in the source, and in the [diagnostic logs](#diagnostic-logs).
- **Secrets never show.** A secret reaches a command through the step's `secretEnv`, so the command's text never holds
  it, and `-vv` shows `"$TOKEN"` where it's used. The step's record keeps its variables, with each secret as
  `[MASKED]`, and the output and errors of that command and of every later command on the host are masked the same
  way. `maskOutput` masks a command's own output, for a secret read from the host (see [Steps](./steps.md#commands)).
  Every command is recorded, so the record is the one place to enforce that. The sudo preamble and the variables wrap
  each command after the recorder has seen it, so neither is recorded as part of the command.
- **A failure doesn't need them.** A failed step's error already names the command that failed and its stderr.

The same host at each level, in `apply`, with a `sudo: true` file that changes, and the run it triggers:

```
sonarr                                                    # default
  ~ change:    (file) /etc/systemd/system/sonarr.service
      <diff>
  > triggered: (run)  Reload systemd

sonarr                                                    # -v
  · observed:  (read)   uname -m
  = unchanged: (ensure) Install sonarr
  ~ change:    (file)   /etc/systemd/system/sonarr.service
      options: sudo
      <diff>
  > triggered: (run)    Reload systemd

sonarr                                                    # -vv
  · observed:  (read)   uname -m
  = unchanged: (ensure) Install sonarr
      commands:
        $ command -v sonarr
  ~ change:    (file)   /etc/systemd/system/sonarr.service
      options:
        sudo: true
      <diff>
      commands:
        $ <file details script>
        $ <file content>
        $ <file write script>
        $ <file details script>
  > triggered: (run)    Reload systemd
      commands:
        $ sudo systemctl daemon-reload

sonarr                                                    # -vvv
  · observed:  (read)   uname -m
      exit:   0
      stdout: x86_64
  = unchanged: (ensure) Install sonarr
      commands:
        before $ command -v sonarr
                 exit:   0
                 stdout: /usr/bin/sonarr
  ~ change:    (file)   /etc/systemd/system/sonarr.service
      options:
        sudo: true
      <diff>
      commands:
        before $ <file details script>
                 exit:   0
                 stdout: <the file's details>
        ...
  > triggered: (run)    Reload systemd
      commands:
        $ sudo systemctl daemon-reload
          exit: 0
```

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

- **Streams.** The whole report goes to stdout, failures included. stderr is only for tsinfra's own errors and the sudo
  password prompt (see [Transport](./transport.md#sudo)). The errors are a usage error, or hosts that can't be
  discovered or loaded. Those print through Optique's `printError`, so they look like the
  parser's own errors. They happen before any host runs, so they never mix with a report. A theme passed to both
  `run()` and `printError` makes the `Error:` label red and bold. Optique colors stderr only when it is a terminal.
- **Colors** come from [picocolors](https://github.com/alexeyraspopov/picocolors). It follows `NO_COLOR`,
  `FORCE_COLOR`, and `--no-color`, and prints plain text when stdout is not a terminal. `util.styleText` from `node:util`
  does the same, but its behavior depends on each runtime's `node:util`, and picocolors' rules are its own. Tests set
  `NO_COLOR` in the test preload, before anything imports picocolors.
- **Status lines.** A host's block is its name, then its entries, or "no steps" for a script that made none. Each entry
  is a status line, with its details and any error on the lines under it. A status line starts with the entry's status,
  as a symbol and a word in the status's color, then an uncolored colon, like `~ change:`.
  Then comes the step's kind in dim parentheses, like `(file)`, and then its name. The status and the kind are each
  padded to the widest in the block, so every kind and every name starts in one column. The parentheses keep the kind
  apart from the name without color. A failure no step owns shows `(preparation)` or `(host fn)` in place of a kind,
  also in italics, so it doesn't read as a kind of step (see [Kinds of failure](#kinds-of-failure)). A `changed` step from `ensure`, `file`, or `link` is `~ change`, and a `ran` step from `run` is
  `> triggered`, because a step it follows changed. Any failed step is `! failed`, because the status matters more than the kind once
  something broke, and the error already says what failed. In `--verbose`, every step that was already right is `= unchanged`,
  whatever its kind, so it doesn't rely on color to tell it from a change. A run whose trigger didn't fire is `= unchanged` too,
  because nothing needed doing. A read or inspect has its own `observed` status, so it gets a gray `· observed` rather than `=`.
- **Failures.** A failed step shows its error's message chain on indented lines under it, in bright red, so it stands
  apart from a red `got:` value. Its `!` and the host's `failed` in the summary are bright red too. That includes a
  failure the script caught inside the step, because the step still fails. The details a step found, like `got:` and
  `want:`, are indented further and are not red, because they are not the error. A host function failure is the
  block's last `!` line, `(host fn)` and the host's target (like `(host fn) web.lan`), with its error under it the same
  way, then the note "thrown in the host function, outside any step", because `host fn` alone doesn't say the failure
  came from the script and not the host. A preparation failure never ran the script, so its block has one `!` line,
  `(preparation)` and its target (like `(preparation) web.lan`). Both name the target, because the kind already says where it failed. Neither error is wrapped in "failed to run host" or "failed to prepare the host", because the
  block's header names the host and the kind says where it failed. A failure can have a hint under it, in italic yellow, with no label, saying how to fix
  it. A host that leaves `sudo` off and fails in a step whose own `sudo` needed a password gets "sudo needs a
  password on this host, so set the sudo option on host()" under that step (see [Transport](./transport.md#sudo)).
- **Failure details.** A failure that still differs after its fix shows its `after` values, then any stderr that can
  explain it, from its `fix` and `after` phases. A phase that ran one command, which wrote to stderr, gets a
  `stderr: <command> -> <stderr>` row. It's clear what that stderr relates to, because that command is all the phase ran.
  A phase that ran several commands, any of which wrote to stderr, can't say which one matters, so it gets a note
  instead: "some commands during the fix wrote to stderr, run with -vvv to see what they printed", or "after the fix"
  for the `after` phase. `-vvv` leaves the note out, because each command's stderr already shows under it. Commands
  tsinfra wrote itself never count. The `before` phase never shows here, because it ran before the fix, so it can't
  explain the state after it. A failed fix, or a compare after the fix that failed, shows only its error,
  which already holds its stderr. `--verbose` adds the values from before the fix under a "values before the fix" note,
  which is there because they may no longer be true.
- **Values** are cyan when they came from the script or the host, like the command in a `stderr:` row and the command a
  read or inspect is named by. The stderr in that row is bright red like an error, so it stands apart from its command. That sets them apart from tsinfra's own words. A `got:` value is red and a `want:` value is green, like a
  diff's `-` and `+` lines. A string value keeps its quotes, so an empty one still shows without color, but the quotes
  stay uncolored, so they don't read as part of the value. An exit code is also italic, because it isn't quoted. A
  multi-line value's later lines line up under its first line's text. The labels, like `got:`, are dim, so the values
  stand out.
- **Colors** follow the status: a summary's change count matches `~` and `>`, and its waiting count matches `?`. The
  plan reminder is dim, so the host lines stay the main thing in the summary. In a block, the notes line up in one
  column. A waiting step's note is `needs 'A', 'B'`. A failure no step owns never gets a note.
- **Options.** The `options:` heading is dim and italic, its keys are dim like other labels, and its values are styled
  like other values, so a string keeps its quotes. `[MASKED]` is dim and unquoted, because it's tsinfra's marker, not a
  value the script gave. On the line, an object's variable names go in braces after its name, like `env { URL, PORT }`,
  with the braces dim. A colon there would nest under `options:`, and the braces keep one object's names apart from the
  next. It's the first of a step's details, and on a failed step it comes after the error, like its other details.
  Only options the step set show, so `sudo: false` and an empty `env` never do. Only options whose effect shows
  nowhere else in the report show: `sudo`, `env`, and `secretEnv`, `file`'s `validate`, as the command it built,
  `secret`, and `overwrite: false`, `link`'s `force`, and `ensure`'s `verify: false`. A step that used one of those can
  look the same as one that didn't. `want`, `content`, `mode`, `user`, `group`, `needs`, and `after` already show as
  values, diffs, attribute rows, notes, or a status, and `check` and `fix` show as commands. The shell options come
  first, then the step's own, in the order they were recorded.
- **Warnings.** A step that worked but needs a look, like a link to a missing path, gets a `warning:` line under its
  details, with the label in bright yellow, so it stands apart from the plain yellow of a change. A warning makes its
  step show even when it was already right, without `--verbose`. The report decides what's a warning from the facts
  in the record, so no step records words. A failed step gets none, because its error is what needs fixing first. A
  warning isn't drift, so it doesn't change the exit code.
- **Levels.** Every piece of a block has the lowest level it shows at: a step's own line, each of its options, each
  part of its note, and each detail under it. A piece's level comes from what it is, like 1 for the line of a step that
  was already right, 1 for the options line, and 0 for a warning. A piece can also stop at a level, like the options line, which the block replaces from 2. A piece shows once its own level is reached, or when anything inside
  it shows, and a step that shows always prints its own line. So a warning, at 0, shows its step at the default level,
  even when the step was already right. The report builds every piece for every step, then keeps the ones the level
  shows, before it lines up the columns, so a hidden piece never widens one. A diff is the exception. It's one piece
  at every level, and the level only sets its limits, because computing a full diff only to drop it would be slow.
- **A host with nothing to show** gets no block, only its line in the summary. A host whose script made no steps
  isn't one, because its "no steps" block shows that it ran.
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
  live area, where it stays. The block is the same text `renderHostBlock` produces, so the live view and the report never
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

The output is built from a record of each host's run. It holds the commands its preparation ran, one list of steps,
in the order the script called them, and the host's failure, if it failed.

- **Preparation's commands** are every command it ran for the host, on the control machine and on the host: `ssh -G`,
  the reads of the home directory and the user, the sudo checks, and the askpass helper write. A sudo password check
  records `<sudo password>` in place of the password, so the password never reaches the record.

- **The failure** is the host's only one, because nothing runs on a host once it has failed. It records its error, its
  kind (see [Kinds of failure](#kinds-of-failure)), and any hints for it. The kind comes from where the host was when it
  failed: in preparation, in a step, or in the host function outside any step. A host whose preparation failed has no
  steps.
- **A step** records its kind (`read`, `inspect`, `ensure`, `run`, `file`, or `link`), its name, and its status. A read
  or inspect has no name, so it records its command. A step records the options it set that the report shows, by
  name, as one record: first its shell options, the ones that change how every command in it runs (`sudo`, `env`, and
  `secretEnv`), then its own, like `file`'s `validate` command or `overwrite: false`. An option at its default isn't
  recorded, and each secret value is `[MASKED]`. Its commands are recorded as the script wrote them, without the
  `sudo sh -s` around them or the prelude that sets the variables, so the options are what say those were there. The
  record holds plain values only: `validate` as the command it built, because the script passed a function. A step's
  handler records its own options right after validating them, through a function the recorder gives it, like
  `converge`'s, so a failure can't lose them. The step that's running is kept apart on the host's
  record until it ends, so the record always says which step is running. A step that finishes joins the host's steps,
  in the order the script called them, with its status.
- **A step's commands** are every command that ran while it was running, including those from reading its state and from its fix
  functions. A read or inspect has exactly one.
- **A command** records the command, its stdout and stderr, and its exit code. A command that could not run at all
  records the error instead. A command tsinfra wrote itself also records a short label, like `file details script`.
  A command in a step that compares the host's state records its phase: `before`, `fix`, or `after`.
- **A step's comparisons** are what it found each time it compared the host with what it wants: a `before` comparison,
  and an `after` comparison when it compared again after the fix. Each holds the values it compared and whether they
  matched.
- **A waiting step** records the names of the needed steps it waited on.
- **Secrets are masked as they're recorded.** The session keeps the host's known secrets, from each step's `secretEnv`
  and each `maskOutput` command, and replaces each one with `[MASKED]` in everything it records from then on, so the
  record never holds a secret. Preparation never sees one, so it masks nothing.

A step never records anything itself. It returns its one status, or an error, and the record gets everything else from
the wrappers the step runs through: the shell's transport records commands, and `converge` records comparisons. So a
failure keeps what the step found before it.

A step's status is `unchanged`, `changed`, `ran`, `waiting`, or `observed`. `changed` means the host's state differed.
`ran` means a run's trigger fired, or its `after` was `"always"`. `waiting` means a step it needs would change. A read
or inspect is always `observed`. The record is the same in `plan` and `apply`, and so is each step's status line. A changed
step's details come from its `before` comparison, so `apply` can show what a step changed too.

A failed step has no status. Its record never joins the host's steps. The host's failure holds it, with its error, so
the fact that it failed lives in one place, and the report shows it after the other steps. That includes a failure the script caught inside the step. Steps called after the host failed
throw without running, so they are not recorded, and the step that failed is always the last one. A failure that is
not a step's, like a bug in the script, is a host function failure.

### Kinds of failure

A failure is one of four kinds, named after what it stops.

- **A startup failure** stops the run before any host exists, like a bad flag, no `hosts/` directory, or a host script
  that won't load. It prints to stderr as tsinfra's own error, and there's no report (see
  [How the report is built](#how-the-report-is-built)).
- **A preparation failure** stops one host while it's prepared, before its script runs, like an unreachable host or a
  sudo password prompt that was skipped. Its block shows `(preparation)` and the host's target, like
  `(preparation) web.lan`.
- **A host function failure** is anything thrown during the host function that no step owns, like a bug in the script.
  It's the block's last line, `(host fn)` and the host's target, like `(host fn) web.lan`, with a note that it was
  thrown in the host function.
- **A step failure** belongs to the step that was running, and shows on that step's status line. That includes a failure the
  script caught inside the step.

Every kind but a startup failure fails only its own host, so the other hosts still run, and the run exits 1.

### Diagnostic logs

Logs are separate from the report. They are for working out what tsinfra itself did, like which SSH command it ran, how
long a connection took, or why it failed. They use [LogTape](https://logtape.org) and go to stderr, so stdout stays the
report.

- **LogTape** has no dependencies and supports Bun. It stays silent until the application configures it, which matters
  because host scripts import tsinfra as a library. It ships a JSON Lines formatter, and `@logtape/pretty` for readable
  terminal output.
- **`@optique/logtape`** adds the logging options to the existing Optique parser: `--log-level` and `--log-output`. It
  can also add a `-v`/`-vv` form, which tsinfra leaves out, because `-v` already sets how much the report shows (see
  [Output](#output)).

Nothing logs yet. LogTape is its own feature, added on its own.

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
