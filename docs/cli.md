# CLI

<!-- toc -->

- [Hosts](#hosts)
- [plan and apply](#plan-and-apply)
- [Output](#output)
  - [How the report is built](#how-the-report-is-built)
  - [What a host records](#what-a-host-records)
  - [Kinds of failure](#kinds-of-failure)
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

## plan and apply

- **`plan`** reads the host's state for every step and runs no fix. See [Steps](./steps.md).
- **`apply`** reads the host's state for every step and runs every needed fix, in order, with no confirmation prompt. Run `plan` first to see
  what will happen. That is the workflow `~/homelab/justfile` already uses, with `apply` passing `-y` to pyinfra.

Hosts run one at a time, in the order of their names (see
[Running hosts in parallel](./roadmap.md#running-hosts-in-parallel)). Steps within a host always run one at a time, in
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
  inspect as a `·` line named by its command. It also shows every diff and every differing line in full, and a failed fix's values from before
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
- **`-vvv`** also shows what each command printed, as `exit:`, `stdout:`, and `stderr:` rows under a dim italic
  `output:` heading, one level past the command's text, with their values lined up. The heading keeps the rows from
  reading like more of a multi-line command. A read or inspect, which lists no command, shows its `output:` heading and
  rows right under its line, after any options. Every command shows its exit code, even 0, and a command that couldn't
  run at all shows its error in place of the three rows. stdout and stderr show in full, because this level is for
  seeing everything, and only when the command printed something. Each has its trailing whitespace trimmed, and keeps
  its leading whitespace. In a step that compares the host's state, each command starts with its phase in parentheses,
  styled like a step's kind, as `(before)`, `(fix)`, or `(after)`, padded so the prompts line up, because the same check
  runs before and after the fix, and its output can differ. tsinfra's own commands keep their label, so their text never
  shows. It's in the source, and will be in the [diagnostic logs](./roadmap.md#diagnostic-logs).
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
      output:
        exit:   0
        stdout: x86_64
  = unchanged: (ensure) Install sonarr
      commands:
        (before) $ command -v sonarr
                     output:
                       exit:   0
                       stdout: /usr/bin/sonarr
  ~ change:    (file)   /etc/systemd/system/sonarr.service
      options:
        sudo: true
      <diff>
      commands:
        (before) $ <file details script>
                     output:
                       exit:   0
                       stdout: <the file's details>
        ...
  > triggered: (run)    Reload systemd
      commands:
        $ sudo systemctl daemon-reload
            output:
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
open (see [the roadmap](./roadmap.md#what-plan-output-should-look-like)).

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
- **Stages.** A host's record becomes text in five stages, each with one job:
  - **Model** (`report/host-block/`) turns the record into blocks, entries, and details, with the level each detail
    shows from.
  - **Palette** (`styles.ts`) holds the looks several elements share on purpose, like red for what's on the host and
    green for what the script wants, so a `got:` value and a diff's `-` line always match. It's the only place
    picocolors is used.
  - **Elements** (`report/format/elements/`) each format one element of the output from its data, like a status, a
    kind, a label, or a value. An element decides how something looks, and structure decides what it says. So an
    element adds its own markup, like the parentheses around a kind, the quotes at a value's edges, or the `(empty)`
    marker, and picks its own look from the palette, so it never takes a style. It holds none of tsinfra's words. It
    doesn't know where it ends up. Elements look alike only by choice,
    like a kind and the `(empty)` marker, which are both muted, so either can change alone. The files are named after
    what their elements are about, never after a layout shape like a row. A formatter for one kind of data, like a
    file's size, stays private next to its caller, and its text can go through an element after it.
  - **Structure** (`report/format/details/`, the rest of `report/format/`, and `report/summary.ts`) puts elements
    together into a detail's rows or an entry's lines. It adds separators, like the colon after a status or the `, `
    between counts, and every word: label and heading names, sentences, count phrases, and the words for the model's
    data, like a warning's or a hint's kind. Each detail kind has its own file in `details/`, so its words live with
    it.
  - **Layout** (`report/format/layout.ts`) pads and indents the rows into columns.
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
  explain it, from its `fix` and `after` phases. A phase that ran one command, which wrote to stderr, gets a `command:`
  row and a `stderr:` row, so each label names its own value. It's clear what that stderr relates to, because that
  command is all the phase ran.
  A phase that ran several commands, any of which wrote to stderr, can't say which one matters, so it gets a note
  instead: "some commands during the fix wrote to stderr, run with -vvv to see what they printed", or "after the fix"
  for the `after` phase. `-vvv` leaves the note out, because each command's stderr already shows under it. Commands
  tsinfra wrote itself never count. The `before` phase never shows here, because it ran before the fix, so it can't
  explain the state after it. A failed fix, or a compare after the fix that failed, shows only its error,
  which already holds its stderr. `--verbose` adds the values from before the fix under a "values before the fix" note,
  which is there because they may no longer be true.
- **Values** are cyan when they came from the script or the host, like the command in a `stderr:` row and the command a
  read or inspect is named by. The stderr in that row is bright red like an error, so it stands apart from its command. That sets them apart from tsinfra's own words. A `got:` value is red and a `want:` value is green, like a
  diff's `-` and `+` lines. The labels, like `got:`, are dim, so the values stand out. A multi-line value's later lines
  line up under its first line's text.

  A string shows in its color alone, with no quotes. Where it can't show as itself, it gets a dim marker or quotes:

  | Value or line                               | Shows as    |
  | ------------------------------------------- | ----------- |
  | Empty, a whole value or one of its lines    | `(empty)`   |
  | Only whitespace, like `"  "`                | `'  '`      |
  | Leading or trailing whitespace, `" active"` | `' active'` |

  The marker is dim, like `[MASKED]`, because it's tsinfra's word, not the value. It says "empty", not "blank", because a
  value of only whitespace shows quoted, so `""` and `"  "` never look the same. The quotes stay uncolored, so they
  don't read as part of the value.

  Italics mark a value that isn't a string but could pass for one. A boolean or a number prints as text a string could
  hold too, like `true` or `501`, so it's italic. An owner row is where this matters most: a user given as the name
  `"501"` shows plain, and one given as the uid `501` shows italic. A value tsinfra renders into its own format, like a
  mode or a size, can't pass for a string the script gave, so it shows plain. A value that's hard to read alone, like an
  exit code, is described in words, like `exit code 1`, and the description is italic as a whole. Without color, a
  string `true` and a boolean `true` look the same, but one comparison never mixes the two.

  These rules cover compared values and the values a script gave, in every step's rows and the `options` block.
  Commands and their output show as they are, because they're for reading, not comparing.

- **Colors** follow the status: a summary's change count matches `~` and `>`, and its waiting count matches `?`. The
  plan reminder is dim, so the host lines stay the main thing in the summary. In a block, the notes line up in one
  column. A waiting step's note is `needs 'A', 'B'`. A failure no step owns never gets a note.
- **Options.** The `options:` heading is dim and italic, its keys are dim like other labels, and its values are styled
  like other values, with the same markers and quotes. `[MASKED]` is dim, because it's tsinfra's marker, not a
  value the script gave. On the line, an object's variable names go in braces after its name, like `env { URL, PORT }`,
  with the braces dim. A colon there would nest under `options:`, and the braces keep one object's names apart from the
  next. It's the first of a step's details, and on a failed step it comes after the error, like its other details.
  Only options the step set show, so `sudo: false` and an empty `env` never do. Only options whose effect shows
  nowhere else in the report show: `sudo`, `env`, and `secretEnv`, `file`'s `validate`, as the command it built,
  `secret`, and `overwrite: false`, `link`'s `force`, and `ensure`'s `verify: false`. A step that used one of those can
  look the same as one that didn't. `want`, `content`, `mode`, `user`, `group`, `needs`, and `after` already show as
  values, diffs, attribute rows, notes, or a status, and `check` and `fix` show as commands. The shell options come
  first, then the step's own, in the order they were recorded.
- **Commands.** From 2, a step's commands show under a dim italic `commands:` heading, each on its own dim line as
  `$ cmd`, in the order they ran, so they read as background next to the details. A command tsinfra wrote itself shows
  as its label in angle brackets, like `$ <file details script>`, and its later lines line up under its first line's
  text. From 3, what each command printed goes under it, under an `output:` heading one level past its text. They
  come after a step's other details, warnings included, and before any hint. A read or inspect lists none,
  because its name is its command. A preparation failure lists the commands preparation ran, under its error and
  before any hint, and a host that was prepared lists none.
- **Warnings.** A step that worked but needs a look, like a link to a missing path, gets a `warning:` line under its
  details, with the label in bright yellow, so it stands apart from the plain yellow of a change. A warning makes its
  step show even when it was already right, without `--verbose`. The report decides what's a warning from the facts
  in the record, so no step records words. A failed step gets none, because its error is what needs fixing first. A
  warning isn't drift, so it doesn't change the exit code.
- **Levels.** Every piece of a block has the lowest level it shows at: a step's own line, each part of its note, each
  detail under it, and the pieces inside a detail, like an option's value or what a command printed. A piece's level comes from what it is, like 1 for the line of a step that was
  already right, 1 for the options line, and 0 for a warning. A piece can also stop at a level, like the "run with -vvv"
  note, which goes away at 3, where the stderr it points at shows. A piece shows once its own level is reached, or when
  anything inside it shows, and a step that shows always prints its own line. So a warning, at 0, shows its step at the
  default level, even when the step was already right. The report builds every piece for every step, then keeps the ones
  the level shows, before it lines up the columns, so a hidden piece never widens one. A diff, and a string `ensure`
  value's rows, are the exception. Each is one piece at every level, and the level only sets its limits, because
  computing a full diff only to drop it would be slow.
- **A host with nothing to show** gets no block, only its line in the summary. A host whose script made no steps
  isn't one, because its "no steps" block shows that it ran.
- **The summary** has one line per host: `unchanged`, `failed`, or a count of changes, where a count includes both
  `changed` and `ran` steps, so it matches the `~` lines in the blocks. A count of warnings follows, like
  `unchanged, 1 warning`, so one isn't lost once the blocks have scrolled away. In `plan`, when any step's state differed, it
  starts with the reminder that steps after a change were checked without it (see
  [Steps](./steps.md#what-plan-can-and-cannot-show)).
- **Diffs** come from jsdiff (the `diff` package), not hand-written code. It is the standard line-diff library for
  JavaScript, has no dependencies, and returns hunks with context as data, which the report colors itself. A file's
  text content shows as a diff. A diff shows 1 unchanged line around each change. Each line is numbered by where it sits in `want`, so a removed
  line, which isn't in `want`, has no number, the way Zed shows a combined diff. A dim rule separates the hunks, and
  another frames the diff above and below, so it stands apart from a `stderr:` row or a `mode:` row after it. A diff
  longer than 15 lines, counting the rules between hunks, shows "long diff (N lines)" instead. A diff that takes longer
  than 200 ms to compute shows "diff took too long to compute". Both suggest `--verbose`, which shows every diff in full
  and allows 10 seconds to compute one.
- **A string `ensure` value** shows as `got:` and `want:` rows under its step, not as a diff, because a check's output
  has no lines for numbers to point to. A multi-line value shows only the lines that differ, which jsdiff picks, so a
  long list with one change stays short. Each line follows the rules in Values, so an empty line or a trailing space
  still shows. An empty value shows as `(empty)`, and a side whose lines are all in the other side has no row, like a lone `want:` row
  for a missing package. The rows don't say where in the value a line sits, so a pure reorder shows the same lines
  under both. More than 15 differing lines show "N lines differ", and lines that take longer than 200 ms to compare
  show "values took too long to compare". Both suggest `--verbose`, which shows every differing line. A boolean or an
  exit code shows nothing, because the step's name says what yes and no mean.

There's no `--json` mode yet (see [Maybe later](./roadmap.md#maybe-later)).

### What a host records

The output is built from a record of each host's run. It holds the commands its preparation ran, one list of steps,
in the order the script called them, and the host's failure, if it failed.

- **Preparation's commands** are every command it ran for the host, on the control machine and on the host: `ssh -G`,
  the reads of the home directory and the user, the sudo checks, and the askpass helper write. A sudo password check
  records `<sudo password>` in place of the password, so the password never reaches the record.

- **The failure** is the host's only one, because nothing runs on a host once it has failed. It records its error, its
  kind (see [Kinds of failure](#kinds-of-failure)), and any hints for it. A hint is recorded as its kind, like
  `unknownHostKey` with the target, and the report picks its words. The kind comes from where the host was when it
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
