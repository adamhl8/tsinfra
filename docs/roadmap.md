# Roadmap

What tsinfra does next, what it plans to do, what's still undecided, what might come later, and what was ruled out. The
rest of the docs describe tsinfra as it is.

<!-- toc -->

- [Next](#next)
  - [Open changes](#open-changes)
- [Planned](#planned)
  - [Running hosts in parallel](#running-hosts-in-parallel)
  - [Live progress](#live-progress)
  - [Reboot](#reboot)
  - [Tasks](#tasks)
  - [Diagnostic logs](#diagnostic-logs)
  - [The `shell` host option](#the-shell-host-option)
  - [Ordering between hosts](#ordering-between-hosts)
- [Follow-ups](#follow-ups)
- [Open questions](#open-questions)
  - [What `plan` output should look like](#what-plan-output-should-look-like)
  - [Interactive commands](#interactive-commands)
  - [Published, or personal](#published-or-personal)
  - [Helpers worth shipping](#helpers-worth-shipping)
  - [Fact helpers](#fact-helpers)
  - [Sending data to a command](#sending-data-to-a-command)
  - [Following symlinks in `file`](#following-symlinks-in-file)
  - [Files over 10 MB](#files-over-10-mb)
  - [`fsync` before the rename](#fsync-before-the-rename)
  - [Backups of replaced files](#backups-of-replaced-files)
  - [Steps side by side within a host](#steps-side-by-side-within-a-host)
- [Ideas](#ideas)
  - [Helper families](#helper-families)
  - [Maybe later](#maybe-later)
  - [Removed resources](#removed-resources)
- [Rejected](#rejected)

<!-- tocstop -->

## Next

### Open changes

A run with `after` fires only when a step it follows changed in the same apply. When the run fails, or the apply never
reaches it, the trigger is lost. The next apply finds those steps already right, so the run never fires on its own (see
[Steps](./steps.md#run)). That happens when:

- **The run fails,** like a typo in `sudo systemctl restart caddy`.
- **The apply stops between a change and its run,** because another step failed, or from Ctrl-C or a dropped
  connection. Putting a run right after its steps makes this gap smaller, but can't close it.

Every other step reads the host's state, so the next apply finds whatever is left to do. Only a trigger, a step's
`changed` used by a later step, exists in one apply alone. So tsinfra saves the changes an unfinished apply made, with
the runs that already ran after each one, on the host, and nothing else. There's no record of resources and no
rollback.

**An open change** is a step's change whose runs may not all have run yet. It stays open until the host finishes
cleanly.

- **Before a change step runs its fix,** tsinfra opens a change for it on the host. Opening it before the fix covers a
  connection that drops right after the fix succeeds.
- **A run that runs opens a change too,** so a run that follows it can still fire. For example, the reload runs and the
  apply stops before the restart that follows the reload.
- **A step that was already right opens no change,** because it fired nothing.
- **Every fix opens a fresh change,** with no runs listed, even for a step whose change is already open. Its runs have
  to fire for the new change. A step that's in sync keeps its open change as it is.
- **Every changed step opens a change,** because tsinfra can't tell at change time whether a run follows it. A run names
  its steps only when the script reaches it. An open change that nothing follows has no effect.

**What a run records.** When a run with `after` succeeds, it adds its name to the open change of each step in its
`after` that has one. Nothing closes then, because a later run may follow the same step.

**Closing the changes.** All of a host's open changes close when the host finishes cleanly, because every run has then
had its turn.

**The next apply.**

- **A step with an open change runs its check as usual.** If the host differs, it's an ordinary change.
- **A step with an open change that's right still returns `changed: true`,** so `after` and `if (x.changed)` fire the
  same as for a real change. Scripts only see `changed`, so they can't tell the two apart.
- **A run fires** when a step in its `after` changed in this apply, or has an open change that doesn't list this run.
- **`needs` ignores open changes.** The change is already on the host, so nothing waits for it.

**In `plan`,** tsinfra reads the open changes and never writes them. A run that an open change would fire shows as
`ran` and counts as drift, so `plan` exits 2. An open change that nothing follows doesn't count.

**The report** gives a step that's still open from an earlier apply a status of its own, `^ resume`, because the
earlier apply's unfinished work picks up from it.
A follow-up that only a still-open change triggered gets a note. Both show at the default level, because the case is
rare and should always be explained:

```
  ^ resume: (file) /etc/caddy/Caddyfile   an earlier apply didn't finish, so its follow-ups that didn't complete still trigger
  > triggered: (run) Restart caddy   triggered because it didn't complete in an earlier unfinished apply
```

- **"Resume",** because it says what happens at that step, like the other status words, and it doesn't read like
  `triggered` at a glance. "Carried over" and "open" don't say what happens, and "unfinished" sounds like the change
  itself is half done.
- **"An earlier apply",** not "the last apply", because a change stays open until a clean finish. Two failed applies in
  a row leave the change from the one before last.
- **"Didn't finish",** not "failed", because Ctrl-C and a dropped connection stop an apply without a step failing.
- **"Still trigger",** not "trigger again", because a follow-up may never have triggered at all. Nothing can tell
  whether any follow-up is left to trigger: the follow-ups come later in the script, and the script can act on
  `changed` without `after`. So the step's note stays true when none is.
- **"Didn't complete"** covers a follow-up that failed, one the apply never reached, and one that's new or renamed
  since.
- **The follow-up's note names no steps,** because the `resume` lines above it already show which steps are still open.
- **A follow-up that a step changed in this pass also triggered shows no note,** the same as today.
- **The words have no tense,** like the status words, because a line reads the same in `plan`.
- **The summary doesn't count a `resume` step as a change,** because it changed nothing. The follow-up counts as it
  does today.

**Saved state.** Open changes are the first part of tsinfra's saved state, one file per host script that later
features can add to, like the run-once marker and the manifest in [Ideas](#ideas). It's called saved state, in code
and in prose, to keep it apart from the host's state, which steps read.

**Where the saved state lives.** `~/.tsinfra/state/<host>.json`, on the host next to the askpass helper, in the SSH
user's home. `<host>` is the `name` in the host's config, not its target. Two host scripts can manage the same
machine, like two that both target `@local`, and step names are unique only within one script, so each gets its own
file. Loading fails when two scripts define the same name, so no two hosts share a file. Every checkout and control machine sees the same saved state, and a rebuilt host starts with none. The file holds only step names, which already show in the output. An open change names
its step by its name, which is unique on a host. A `file` or `link` is named by its path.

**How the saved state is stored.**

- **The file is JSON with a version field.** `openChanges` maps each step's name to the runs that already ran after
  its change, like `{ "version": 1, "openChanges": { "/etc/caddy/Caddyfile": ["Restart caddy"] } }`. An empty list means
  nothing has run after it yet. A format with one change per line would break on a name with a newline in it.
- **Reading it** takes one command in preparation that prints the file. tsinfra parses it on the control machine and
  validates it with an ArkType schema, so the host needs no tools. A missing file means no open changes, which also
  covers a host tsinfra has never touched.
- **A file that can't be parsed, or doesn't match the schema, fails the host,** with an error that names the file.
  Atomic writes mean this only happens when something else went wrong, like a hand edit.
- **tsinfra keeps the saved state in memory** after reading it, and each write replaces the whole file from that
  copy. It never reads the file again during the apply. That's safe because two control machines racing is already a
  cost (see below).
- **A write puts the JSON in its script, quoted with `quoteShellArg`,** like the askpass helper's content, and the
  script reaches the host on `sh -s`'s stdin, like every command. It writes a temporary file and moves it into place, so
  a Ctrl-C mid-write leaves the old file whole.
- **The file is `600`,** and the write creates `~/.tsinfra` as `700` when it's missing, because the askpass setup skips
  it on a host with passwordless sudo. No write needs sudo, because the file is in the SSH user's home.
- **A host that finishes cleanly** closes its open changes. With nothing else in the saved state yet, that deletes
  the file with `rm -f`.
- **There are two writes:** one before each fix or run, and one after each run that succeeds and follows an open
  change. tsinfra skips a write when the saved state in memory didn't change, like a run whose steps have no open changes.
- **The commands that read and write the file aren't in the record** at any verbosity, because they're tsinfra's own
  work, not a step's. They belong in [diagnostic logs](#diagnostic-logs).

**Duplicate names fail the host,** with an error that names both steps. Numbering the repeats wouldn't help, because a
number is a position. Adding a step earlier in a loop, or reordering its list, moves every open change after it onto
the wrong step. React asks for a key on each item in a list for the same reason. The rule covers `file`, `link`,
`ensure`, and `run`, whose names also show in `needs`'s `needs 'X'`. A read is named by its command, and reading the
same thing twice is fine. A step is found only when the script reaches it, so the error comes when the second one is
reached, and `plan` fails the same way. A script that already repeats a name breaks.

**Costs:**

- **A run that already succeeded fires again** when it was renamed between applies, because the open change doesn't
  list its new name. Runs are meant to be safe to repeat.
- **A renamed change step loses its open change,** which is how every trigger works today.
- **A changed step opens its change before its fix,** one extra command. A run that succeeds writes its name to the
  open changes it follows, one more.
- **Two control machines applying to one host at once can race on the saved state.** tsinfra has no locking today either.

**Implementation plan.** Each numbered piece is one commit. A piece can leave the feature unfinished, but it passes
lint and has its own tests. The lettered steps inside a piece are small enough to review one at a time, in order.

#### 1. Reject duplicate step names

- **1a.** Keep a map from name to kind for the host's `file`, `link`, `ensure`, and `run` steps in `createHostSession`
  (`src/session/session.ts`). Key it by the unmasked name, because the record's names are masked.
- **1b.** In `callStep`, after `startStep`, fail the step when its name is already in the map, so the error shows under
  the second step. A draft of the words: `run 'Restart caddy' has the same name as an earlier ensure step`.
- **1c.** Test in `src/session/__tests__/session.test.ts`: two ensures with one name, a `file` and a `link` on one path,
  `plan` failing the same way, and two reads of one command passing.
- **1d.** Document the rule where [Steps](./steps.md#steps) describes step names, and in the README's TIP on naming a
  step.

#### 2. Keep the tests' open changes apart

From piece 5 on, every change in an `apply` opens a change in the host's home. Tests run at once on `@local`, and a
test that calls `h` directly never reaches the clean finish that closes them.

- **2a.** Give each `@local` test host a home of its own. The test preload (`src/__tests__/test-setup.ts`) mocks
  `buildHostDetails` with a wrapper that calls the real one and swaps the `home` it read for a fresh temp directory.
  Tests can't move `HOME` itself, because Bun's `spawn` gives commands the environment the test run started with, and
  `runProcess` doesn't pass `process.env`, so a host script's changes to it never reach commands. This only isolates
  saved state because piece 3 builds its path from the session's `home` (see 3c).
- **2b.** Give the test sessions their `home`, so a test that resolves `~/` compares with it, not `os.homedir()`.
- **2c.** Check `home` once, in `buildHostDetails`, and fail preparation when `$HOME` is empty or doesn't start with
  `/`. Every `home` that reaches a session is then absolute, so `resolveHome` drops its two checks and only replaces
  the `~`. The `path.test.ts` cases for an empty or relative `$HOME` move to a preparation test. A host with no `$HOME`
  now fails `plan` too.
  - `validateHome(rawHome): Result<HomeDirectory>` in `host-details.ts` runs the checks, with errors about the host's
    `$HOME` itself: `$HOME isn't set on the host`, and `$HOME on the host is 'x', not an absolute path`.
  - `HomeDirectory` is a branded string, like `Bytes`, and `validateHome` holds its only cast. `HostDetails.home`,
    `SessionContext.home`, `StepContext.home`, `resolveHome`, and the path helpers in 2d all take it, so a raw `$HOME`
    can't skip the check. `session/` imports only the type from `hosts/`.
  - Tests that make up a home, like `path.test.ts`, get one from `validateHome`, and the test preload's mock brands its
    temp directory the same way.
- **2d.** Add `hosts/prepare/host-details/tsinfra-directory.ts` as the one place that lists what tsinfra keeps on a
  host: `TSINFRA_DIRECTORY_NAME` (`.tsinfra`), `toAskpassHelperPath(home)`,
  and later `toSavedStatePath(home, hostName)`, re-exported through `host-details.ts` once `prepare.ts` needs it.
  They only join paths, because `home` is already checked. The askpass
  helper isn't saved state: it holds no data, is rewritten every run, and serves every host script on the machine. It
  only shares the directory.
- **2e.** Make `transport/sudo.ts` take a finished `helperPath`, for both the write script (now
  `buildAskpassHelperWriteScript(helperPath)`) and the `sudo` function (`createAskpassSudoTransport(transport,
  password, helperPath)`), quoted with `quoteShellArg`. `buildHostDetails` and `finishHostDetails` both get it from
  `toAskpassHelperPath(home)`, so they stay in sync without a new field.
- **2f.** Tests: `sudo.test.ts` passes a path in a temp directory instead of faking `HOME`. The sudo Docker tests still
  find the helper in the real home, because `buildHostDetails` writes it before the test preload swaps `home`.

#### 3. The saved state file

A new package, `src/session/saved-state/`, with `saved-state.ts` as its main module. Its only entry is the saved state
manager, which nothing calls yet.

- **3a.** The ArkType schema and its type: `{ version: 1, openChanges: Record<string, string[]> }`. A `version` that
  isn't `1` fails the schema, so a later format change fails loudly instead of being misread. Keys the schema doesn't
  know are ignored, which is ArkType's default.
- **3b.** The read: one command, `if [ -e <path> ]; then cat -- <path>; else printf '%s' <marker>; fi`, run with
  `exec`, so a failed `cat` is an error. A marker matches how the file details script reports a missing path, and it
  isn't valid JSON, so it can't be mistaken for a file's contents. ArkType parses the output and checks it in one
  schema (`type("string.json.parse").to(savedStateSchema)`), so a file that isn't JSON fails the same way as one with
  the wrong shape. It returns `Result<SavedState | undefined>`, where `undefined` means there's no file, so a missing
  file never stands in as an empty saved state. Each error names the file, like
  `the saved state in '<path>' isn't saved state tsinfra wrote -> version must be 1 (was 2)`.
- **3c.** The write script comes from `buildPrivateFileWriteScript` in `src/utils.ts`, which the askpass helper's
  write uses too: `set -eu`, `umask 077`, `mkdir -p` on the file's directory, a temp file with the content from
  `quoteShellArg`, and `mv -f` into place, plus `chmod 700` for an executable like the askpass helper. The saved state
  is written as indented JSON with a trailing newline, so it reads well on the host. The delete is `rm -f`. Use
  `umask 077`, not `mkdir -p -m 700`, because `-m` applies only to the last directory, so a write on a host with
  passwordless sudo, where the askpass setup never made `~/.tsinfra`, would leave it `755`. The umask makes every
  directory the write creates `700` and the file `600`. The package takes the file's path finished,
  from `toSavedStatePath` (2d), and quotes it with `quoteShellArg`. It never writes `"$HOME"` in a script, so the test
  preload's `home` reaches it.
- **3d.** The manager, `createSavedStateManager(shell, savedStatePath): Promise<Result<SavedStateManager>>`, like the
  recorders: it reads the file once with 3b, fails when the read fails, and closes over `shell`, `savedStatePath`, and
  the saved state in memory, so nothing outside the package can write the file with another path or shell, or skip the
  read. A follow-up is a step whose `after` names the steps it follows, today a `run` and later a `reboot`. Callers pass
  `stepNames` as the names in that follow-up's `after`. It returns:
  - `openChange(name)` opens a fresh change, with no follow-ups listed.
  - `isOpen(name)`.
  - `getOpenChangesMissingFollowUp(followUpName, stepNames)` returns the steps whose change is open, but whose
    completed follow-ups don't list it. A non-empty result means the follow-up fires.
  - `recordFollowUp(followUpName, stepNames)` adds the follow-up to each of those steps' open changes.
  - `closeAll()`.

  No saved state (`undefined`) means no open changes. Each write uses the script from 3c, and is skipped when the saved
  state didn't change. The memory changes only after a write succeeds, so it always matches the file. `closeAll`
  deletes the file while open changes are all the saved state holds, and skips the delete when there was never a file
  and nothing was opened. The manager doesn't know the mode: its callers only call the writing functions in `apply`,
  where the step already branches on the mode, so the rule lives in one place.

- **3e.** Tests in `src/session/saved-state/__tests__/`, on `@local`'s shell, with the file in a temp directory whose
  name has a quote and a space:
  - a round trip: open a change, record a run, create a new manager, and read it back
  - a missing file, which opens no changes
  - invalid JSON, and a file that fails the schema, each naming the file
  - the file's `600` mode, and `700` on every directory the write creates, including a missing `.tsinfra`
  - `closeAll` deleting the file
  - a skipped write running no command, through a shell that counts its commands

#### 4. Read the saved state in preparation

Folded into piece 3's commit, because knip reports piece 3's package as unused until preparation imports it.

- **4a.** Add `toSavedStatePath(home, hostName)` to `tsinfra-directory.ts`, which returns
  `<home>/.tsinfra/state/<hostName>.json`, and re-export it through `host-details.ts` for `prepare.ts`.
- **4b.** Create each host's saved state manager in `prepareHosts`' parallel step, right after `buildHostDetails`
  returns, so every host's read happens at once. `buildSessionContext` runs one host at a time, because the password
  prompts take turns, so a read there would add a round trip per host in series. Use an unrecorded
  `createShell(baseTransport)`: saved state never needs sudo, so the base transport works even for a host still
  waiting for its password prompt. A failed read fails preparation for that host through
  `preparationRecorder.recordFailure`, so it's never asked for a password. The test mock's temp `home` reaches it,
  because the manager is built from the details `buildHostDetails` returned.
- **4c.** Add `savedStateManager: SavedStateManager` to `SessionContext`, and re-export `createSavedStateManager` and
  `SavedStateManager` through `session.ts` for `hosts/`. Nothing destructures it until piece 5.
- **4d.** Keep one temp home per `LoadedHost` in the test preload's mock, in a `WeakMap<LoadedHost, HomeDirectory>`.
  Preparing the same `loadedHost` twice gives the same home, so a test can run two applies on one host, which piece 6
  needs, or put a file in its home between preparations. Every new `loadedHost`, which the session helpers create,
  still gets a fresh home.
- **4e.** Test in `src/hosts/__tests__/prepare.test.ts`:
  - a host with no saved state prepares, and preparation's commands include no saved state read
  - saved state carries over: open a change through `sessionContext.savedStateManager`, prepare the same `loadedHost`
    again, and the new manager reports it open
  - a bad file fails preparation with the file's path: prepare, write `{` to `toSavedStatePath(home, name)`, and
    prepare again

#### 5. Open changes in `apply`

After this piece, changes open and runs are recorded on them, but nothing fires from them yet.

- **5a.** Open a change right before a step's fix in `converge` (`src/session/handlers/shared/converge.ts`), after the
  "not in sync, and not `plan`" checks and before `startPhase("fix")`. `createConverge(mode, recorder, openChange)`
  takes the hook, and `callStep` builds `converge` per step with
  `openChange: () => savedStateManager.openChange(validName)`, so `converge` knows neither the step's name nor saved
  state. This covers `file`, `link`, `ensure`, and `verify: false`. A failed write fails the step before the fix runs,
  with the manager's own error.
- **5b.** Add `savedStateManager` to `StepContext`. In `apply`, once the trigger fires, `handleRun`
  (`src/session/handlers/run.ts`) opens the run's own change before its command, for `after: "always"` too, so a run
  after it can still fire.
- **5c.** After a run with a list in `after` succeeds, record it with
  `recordFollowUp(stepName, after.map(({ name }) => name))`. A run whose command fails stays open, and isn't listed on
  the steps it follows, which is what makes it fire next time. A failed record fails the run's step, even though its
  command succeeded: the run isn't recorded, so it fires again next time, which is safe.
- **5d.** Close the host's open changes in `runHost` (`src/hosts/run.ts`) when the host finished an `apply` without a
  failure. `plan` never closes or writes anything.
- **5e.** A failed delete fails the host with a new unowned failure kind, `saved state`, which the report shows like
  `(preparation)`: an italic label and the error. A `host fn` failure doesn't fit, because its note says the error was
  thrown in the host function. `RecordedUnownedFailure["kind"]` gains `"saved state"`, and `cli.md`'s "Kinds of
  failure" gets a line for it.
- **5f.** Test, mostly through the session helpers, which never reach `runHost`, so what a test opened stays to inspect:
  - `plan` with a changing `ensure` and a run after it writes no file
  - `apply` with a changing `ensure` and a run after it leaves the `ensure` listing the run, and the run open
  - a run whose command fails stays open, and the `ensure` doesn't list it
  - `verify: false` still opens a change
  - an `after: "always"` run opens its own change and records nothing on another step
  - a clean `apply` through `runHost` leaves nothing open when the same host is prepared again
  - a failed delete fails the host with the `saved state` kind

#### 6. Fire runs from open changes

A step's change is **still open from an earlier apply** when the step is in sync and its change is open. A step opens
its change in this apply only right before it changes something (before the fix in `converge`, before the command in
`handleRun`), and then it ends `changed` or `ran`, or fails. `plan` never opens anything. So an `unchanged` step with an
open change can only have one an earlier apply opened and never closed. Two step statuses carry what the rest of the
feature needs: `resume` for that step, and `ranFromOpenChanges` for a run only such changes triggered.

- **6a.** Add a `resume` status. `withChangeStepResult` (`src/session/handlers/shared/change-step-result.ts`), which
  every change step's result goes through and whose `ctx` already has `savedStateManager`, makes an `unchanged` step
  whose `savedStateManager.isOpen(stepName)` is true `resume`, runs included. `COUNTS_AS_CHANGED` counts `resume`, so
  the script gets `changed: true`. The record holds the real status, so nothing else carries the fact. It also adds the
  step's name to `changedStepNames`, a set on `StepContext` that the session's steps share, from the handler's own
  status, before it can become `resume`, so the set holds only the steps that changed in this pass. 6b and 6c read it.
  Tests, each running two applies on one `loadedHost`, which the test preload gives the same home:
  - a step still open from an earlier apply is `resume` and returns `changed: true`, in `apply` and in `plan`
  - a run that didn't trigger, but is still open, is `resume` and returns `changed: true`
  - a step that isn't open stays `unchanged`, and one that changes again is `changed`
- **6b.** Make `converge` a plain function, `converge(ctx, spec)`, like `withChangeStepResult` and `runChange`.
  `StepContext` gives it `convergeRecorder` in place of a prebuilt `converge`, and it opens the step's change with
  `savedStateManager.openChange(stepName)` itself. In `plan` a step waits only on a needed step in `changedStepNames`,
  because a step only still open from an earlier apply has its change on the host already. Test that a step that needs
  one in `plan` doesn't wait.
- **6c.** Fire a run in `evaluateTrigger` when a step in its `after` is in `changedStepNames`, or
  `getOpenChangesMissingFollowUp(stepName, afterNames)` isn't empty. In `apply`, a step that really changed has a fresh
  open change, so the two agree. The first only matters in `plan`, where nothing opens. A still-open step whose open
  change already lists the run doesn't fire it again. `after: "always"` is unchanged. Tests:
  - a run that fails, then works
  - a host that fails between a change and its run
  - a run the open change already lists doesn't fire
  - two runs after one step, with the host failing between them
  - a run after a run
  - a step that changes again after its run ran
  - `plan` showing a fired run without writing, not showing one the open change lists, and showing one whose step
    drifts again
- **6d.** Add a `ranFromOpenChanges` status for a run that only changes still open from an earlier apply triggered:
  no step in its `after` changed in this pass, and one has an open change missing it. `evaluateTrigger` returns the
  run's status, `unchanged`, `ran`, or `ranFromOpenChanges`, and `handleRun` passes it on. It counts as changed, like
  `ran`, so a run after it triggers. Piece 7 shows its note and counts it as drift from the status. A run that fails has
  no finished status, so it gets no note, and the `resume` line above it explains it. Tests: the runs in 6c's tests
  that only open changes trigger are `ranFromOpenChanges`, and a run a step changed in this pass triggered is `ran`,
  though another step in its `after` is still open.

#### 7. Report open changes

- **7a.** Show `resume` with the word `resume`, the symbol `^`, and cyan, and `ranFromOpenChanges` like `ran`, as
  `> triggered` in yellow. `ENTRY_LEVELS` (`src/report/host-block/entries.ts`) shows both from level 0. The summary
  counts `ranFromOpenChanges` as a change, like `ran`, and leaves `resume` out. Test the `resume` line at level 0 and
  the summary's count.
- **7b.** Make `NotePart` a union, and add two parts beside `needs`, both from level 0, built in `toStepNote`
  (`src/report/host-block/note.ts`) from the entry's status:
  - `resume`, on a `resume` entry: "an earlier apply didn't finish, so its follow-ups that didn't complete still
    trigger"
  - `triggeredByOpenChange`, on a `ranFromOpenChanges` entry: "triggered because it didn't complete in an earlier
    unfinished apply". It names no steps.

  The words go in constants beside `getNotePartWords` (`src/report/format/status-line.ts`). Test both notes in `apply`
  and `plan`, and that a failed run shows its error with no note.

- **7c.** Count `ranFromOpenChanges` as drift in `hasDrift` (`src/report/summary.ts`), so `plan` exits 2 and shows its
  reminder. Nothing else in that pass explains the run, and `apply` would run it. Test `hasDrift`, the exit code, and
  the reminder for it, and that a `resume` step whose run already completed isn't drift.
- **7d.** Add both to `report-preview.ts`, as a record of a `resume` step and a `ranFromOpenChanges` run, like the hints
  host. Two applies on one host would leave the second one's saved state in the real home, because the preview has no
  test preload.

#### 8. Docker tests

- **8a.** On Alpine and Debian, over ssh, a host that fails between a change and its run, and then fires the run on the
  next apply. Use a passwordless host, where the askpass setup skips `~/.tsinfra`, so the write has to create it.
- **8b.** A host with a sudo password, whose open changes are written as the SSH user while its steps run with sudo.

#### 9. Docs

- **9a.** Move this design from the roadmap into the docs:
  - open changes into [Steps](./steps.md#run), replacing the paragraph that says a failed run needs a rerun by hand
  - the notes, the record's new fields, and the exit code into [CLI](./cli.md)
  - the saved state file next to the askpass helper in [Transport](./transport.md)
- **9b.** Rewrite the "No state" section in [the design notes](./README.md#no-state), and their "State file" row, to
  say there's no record of resources, only a small saved state on each host that holds open changes.
- **9c.** Change the README's "no state file" bullet, and its TIP about putting a run right after its steps.
- **9d.** Remove this section and the "Hint on a failed triggered run" follow-up from the roadmap. Add to
  [Reboot](#reboot) that a reboot follows the same rules as a run.

## Planned

Decided, and wanted eventually, with no place in the order yet.

### Running hosts in parallel

Hosts run one at a time today. `--parallel <n>` runs up to `n` at once (default 8), with each host's output held until
it finishes, and the live progress area under the finished blocks. Steps within a host still run one at a time, in
order.

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

Live progress comes with `--parallel`, because that is when hosts run at once, so progress matters. Until then the
blocks print directly as each host finishes. These details are still open:

- **What tells Ink to redraw.** A spinner redraws on a timer anyway, so the live lines could read the records on each
  tick. The other option is a callback from the session recorder when a step starts or finishes.
- **How much a live line shows.** It could be only the step's name, or also the command running inside it.
- **Long lines.** A failure's error can be wider than the terminal. The terminal wraps it, but the wrapped part loses
  its indent. `Bun.wrapAnsi` could wrap it to the terminal's width and keep the indent, but then the output depends on
  where it runs. Decide once real error output shows whether it's needed.
- **Testing.** `ink-testing-library` renders a component to text frames. The formatting functions keep their own tests
  either way, because they are plain functions.

### Reboot

The Incus host needs it after a kernel change. Until then, it reboots by hand, or with the
[reboot recipe](./recipes.md#a-reboot).

```ts
type RebootOptions = {
  after: ChangeStepResult<"file" | "link" | "ensure" | "run" | "reboot">[] | "always" // the same as a run's
  timeout?: number // milliseconds to go down and come back, default 10 minutes
}
```

```ts
const kernel = await h.ensure("Install the HWE kernel", { ... })
await h.reboot({ after: [kernel] })
```

`h.reboot(options)` reboots the host, waits for it to come back, and carries on with the script. Running `reboot` with
`exec` would drop the connection, so the command would look failed, and nothing would wait for the host. A reboot is a
follow-up to a change, not state a check can read, so it works like a [`run`](./steps.md#run):

- **`after` decides when.** It reboots when a step it follows changed, or on every pass with `"always"`. In `plan` it
  never reboots, and shows as a `>` line, so later steps are checked against the host as it is, like any step after a
  change.
- **How it works.** It reads the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl -n kern.boottime` on
  macOS), starts `sudo reboot` in the background so the command returns cleanly, drops the ControlMaster socket, and
  polls until the host answers. Then it reads the boot id again. An unchanged boot id fails the step with
  `the host didn't reboot`, so a host that never went down doesn't count, the same check Ansible's `reboot` makes.
- **One `timeout`** covers going down and coming back. Ansible splits it in two, which mostly helps it word its errors.
- **It escalates like any command,** through the `sudo` function, so the host declares `sudo` on `host()` (see
  [Transport](./transport.md#sudo)).
- **`@local` refuses it,** with `can't reboot @local, because it's the machine tsinfra runs on`.
- **It's a top-level step.** A fix that installs a kernel doesn't reboot by itself, and the script follows that step
  with `h.reboot`.
- **It returns a `ChangeStepResult<"reboot">`,** so a run can follow it. `"reboot"` joins `ChangeStepKind`, and a
  run's `after`. Like a run's, it can't be needed, because nothing about the host's state says a reboot happened.

### Tasks

A host can have named tasks besides its main function, for work you run on demand, like updates. Configuring a host and
updating it use the same steps, but an update shouldn't happen every time the configuration changes:

```ts
const update = task("update", async (h) => {
  await h.ensure("Upgrade packages", {
    want: [],
    check: "sudo apt-get update && apt list --upgradable | tail -n +2",
    fix: "sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
  })
})

export default host({ name: "sonarr", target: "sonarr.lan", sudo: true, tasks: [update] }, configure)
```

```sh
tsinfra plan sonarr                # the main function
tsinfra plan sonarr --task update  # only the update task
tsinfra plan --task update         # every host that has an update task, and no others
```

- **A task is an ordinary host function,** with the same `h`, steps, `plan`, `apply`, session, and sudo prompt. With
  `want: []`, `plan --task update` lists what would upgrade on every host.
- **`task(name, fn)` mirrors `host(config, fn)`,** and `host()` registers its tasks explicitly with `tasks`, so a task
  only belongs to the hosts that list it. A task exported from a shared module doesn't register itself anywhere.
- **Define a task above the `host()` call,** because `host()` reads `tasks` straight away, and a `const` can't be read
  before its line.
- **Task names are unique within a host.**
- **It isn't tags.** Tags pick steps inside one script. A task is a separate function, so each one still reads top to
  bottom.

### Diagnostic logs

Logs are separate from the report. They are for working out what tsinfra itself did, like which SSH command it ran, how
long a connection took, or why it failed. They use [LogTape](https://logtape.org) and go to stderr, so stdout stays the
report.

- **LogTape** has no dependencies and supports Bun. It stays silent until the application configures it, which matters
  because host scripts import tsinfra as a library. It ships a JSON Lines formatter, and `@logtape/pretty` for readable
  terminal output.
- **`@optique/logtape`** adds the logging options to the existing Optique parser: `--log-level` and `--log-output`. It
  can also add a `-v`/`-vv` form, which tsinfra leaves out, because `-v` already sets how much the report shows (see
  [CLI](./cli.md#output)).

LogTape is its own feature, added on its own.

### The `shell` host option

Decided on 2026-11-11, and skipped from the SSH pieces because nothing needs it yet. It's for a tool whose PATH only a
login shell loads (see [Login shells](./transport.md#login-shells)).

```ts
export default host({ name: "caddy", target: "caddy.lan", shell: ["bash", "-l", "-s"] }, async (h) => { ... })
```

The host option `shell` replaces the whole command that starts the host's shell, as an array of words. The default is
`["sh", "-s"]`. The control machine's own commands, like `ssh -G`, keep `sh -s`.

- **The option is the whole command, `-s` included.** tsinfra adds no flag to it, because it can't know how another
  shell reads its script. The one requirement is that the shell reads its script from stdin.
- **Each word reaches the shell as written.** Locally, tsinfra runs the array as the process's arguments. Over SSH, ssh
  joins its arguments into one string, and the user's login shell parses it, so tsinfra quotes each word with
  `quoteShellArg` first. A single string would mean two things. Split locally, `bash -c 'x'` gives bash the quotes as
  part of its script. Over SSH, the login shell removes them.
- **`sudo: true` runs the same shell,** as `sudo <shell> <<'<delimiter>'`, with each word quoted. Under sudo, `-l`
  loads root's profile, not the user's, because sudo sets `HOME` to root's.
- **tsinfra checks nothing about the shell.** Picking one that works is the user's job. The commands tsinfra writes,
  like the `{ ... } </dev/null` wrapper, the `sudo` function, and `file`'s scripts, are POSIX sh. So the shell must be
  POSIX compatible, and fish is not. A shell that can't run them fails preparation's first command.
- **Its tests:** a local `env` word that sets a variable the script reads, and over SSH a `sh -l` that sees an export
  from the SSH user's `.profile`.

A login shell has two pitfalls, which the user docs should warn about:

- **Anything the profile prints lands in every command's stdout.** That breaks preparation's home directory read and
  `file`'s details, so a profile that prints can't be used.
- **`bash -l` may not load PATH set in `.bashrc`.** A login bash reads `.profile`, which on Debian sources `.bashrc`.
  Debian's `.bashrc` stops early in a non-interactive shell, so a PATH line at its end never runs. Move the line into
  `.profile`. Adding `-i` loads `.bashrc`, but an interactive bash reading a pipe writes prompts and job-control
  warnings to stderr, which lands on the record.

A `path` option may fit that case better (see [Maybe later](#maybe-later)).

### Ordering between hosts

A tentative design, to build after `--parallel` and most of the rest of this section. Until then, the Incus host and its
containers run as separate commands.

One host can rely on another. The Incus host has to create a container before the container's own script can run, and a
database host may need to be up before an app host. A host declares this with `needs`, which takes the host scripts it
imports:

```ts
import incus from "./incus.ts"

export default host({ name: "sonarr", target: "sonarr.lan", needs: [incus] }, configure)
```

- **It's named `needs`, not `after`.** On a `run`, `after` means "only if those changed", but `sonarr` runs whether or
  not Incus changed. A step's [`needs`](./needs.md) already means "depends on this, and waits in `plan`".
- **It takes imports, not names,** because a step's `needs` takes values too, and an editor catches typos and follows
  renames. An import cycle fails when the scripts load, with a confusing error.
- **Hosts run after what they need.** Each host starts once the hosts it needs have finished, which also works with
  `--parallel`.
- **Preparing has to change.** Today every host is prepared before any script runs, and a container that doesn't exist
  yet would fail there. A host with `needs` that can't be prepared gets one more try after the hosts it needs finish,
  and only then fails. A sudo prompt for that host moves to that point too.
- **A new container may not be ready straight away,** so the Incus script should wait for it as its last step.
- **In `plan`, a host that can't be prepared shows as waiting** when a host it needs has changes, like `? needs 'incus'`.
- **A host whose needed host failed is skipped,** and the run exits 1.
- **Picking hosts doesn't add any.** `tsinfra apply sonarr` runs only `sonarr`, because you named it. Order only applies
  among the hosts being run.

Still undecided: whether a host that can be prepared plans normally while a host it needs has changes. The leaning is
yes, because otherwise every container's plan disappears whenever Incus has any change. The stricter rule matches a
step's `needs`, and waits whenever a needed host has changes.

Other approaches, and why they lost:

- **Order of the command line,** like `tsinfra apply incus sonarr --parallel 1`. It needs no new concept, but you'd have
  to remember it every time, and a plain `tsinfra apply` would have no order.
- **Stages or numbered folders.** The whole order is in one place, but a stage also waits on hosts it doesn't depend on.
- **The Incus host declaring its containers.** Adding a container would mean editing the Incus file.
- **Batches and serial runs,** like Ansible's `serial` and `order` and Salt's batch mode. These are for rolling a change
  through a fleet, which isn't the homelab's problem.
- **An orchestration layer,** like Salt's orchestrate runner, which runs states on one group of hosts, then another.
  That's a second language for the order of hosts.

## Follow-ups

Fixes and finishing work for what's already built.

- **Stop remote commands on Ctrl-C.** Without a terminal, Ctrl-C ends the local `ssh`, but the command on the host
  keeps running. nixos-rebuild runs a remote `pkill -SIGINT` when it's interrupted. tsinfra needs the same, with the
  process to stop known, and the run's connections still closed.
- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after
  that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the
  wrong step. `callStep` already builds a fresh set of tools for each step. What's left is to bind them to the step's
  record, and fail the host through `callOrFail` when that step is no longer the running one. Do not throw in
  `recordCommands`, because only `session.ts` throws, and a throw there would skip recording the failure in
  `callOrFail`.
- **Hint on a failed triggered run.** When a run with `after` fails, end its error with a hint, like
  `the steps it follows won't show as changed on the next apply, so run this by hand once it's fixed` (see
  [Steps](./steps.md#run)).
- **Run the Docker tests in CI.** `bask test-docker` stays out of `bask lint`, because it needs Docker and downloads
  images and packages, so nothing runs it automatically yet.
- **Check SELinux labels on a VM.** `file`'s `chcon` and `restorecon` are untested on real labels, because containers
  run with SELinux off.
- **The user docs.** When the full docs get written, start from [Recipes](./recipes.md), and add the comparison with
  other config tools from the [design notes](./README.md#compared-with-other-tools), led by tsinfra's strengths. Warn
  about a login shell's pitfalls once [the `shell` option](#the-shell-host-option) exists.

## Open questions

What still needs an answer. Most are best settled by porting real hosts first.

### What `plan` output should look like

[CLI](./cli.md#output) has a first guess. The evidence so far is `~/homelab/justfile`, whose `plan` recipe filters
pyinfra's JSON down to just the names of pending changes. That suggests the default should be terse, with diffs. Settle
it by running `plan` on the ported Mac and reacting to what it shows. How the report is built is settled (see
[CLI](./cli.md#how-the-report-is-built)), so this is only about what it shows.

### Interactive commands

Some commands need a person at the keyboard, like an installer that asks questions. Commands normally run with their
script on stdin and their output captured, so nothing can answer a prompt.

Two ways to allow it:

- **Inherit the terminal.** Connect the command to the CLI's own terminal (`stdio: "inherit"` locally, `ssh -t`
  remotely). The user answers prompts directly, and tsinfra sees none of the output.
- **A pseudo-terminal.** `Bun.spawn`'s `terminal` option attaches a PTY, so tsinfra sits between the command and the
  user. It can show and record the output, or answer a prompt itself. A sudo password doesn't need this, because
  askpass covers it (see [Transport](./transport.md#sudo)).

Either way it is a separate mode, not how commands normally run. A PTY merges stdout and stderr and would echo a script
sent on stdin, so the command would travel as an argument instead. An interactive command also needs the terminal to
itself, which conflicts with hosts running in parallel and with `BatchMode`. Settle it when a real host needs one.

### Published, or personal

The package is set up for npm (`exports`, `bin`, publint, release-it). If tsinfra stays personal tooling for
`~/homelab`, the packaging work is optional. If it is published, it stays.

### Helpers worth shipping

Candidates from the homelab: an apt package step, brew bundle, a systemd unit with reload, a Docker Compose project, and
`put_files` (a map of local files to destinations). Start with them as functions in `~/homelab/lib`, and move one into
tsinfra only once two hosts use it the same way. [Helper families](#helper-families) has the candidates other tools
suggest.

Each family of shipped helpers gets its own export path, like `tsinfra/apt` or `tsinfra/systemd`, so a script imports
only the families it uses. The root, `tsinfra`, stays the core API: `host`, and every type a script annotates with. The
file mode constants stay in the root too, because they're values for a core step's option, and their types have to be
there for `FileOptions`. A subpath is an entry file like `src/facts.ts`, an `exports` entry in `package.json` with
`types` and `import` like the root's, and whatever the build and knip need to treat it as an entry.

### Fact helpers

A fact is something read from the host that no step changes, like the CPU architecture, which is what a script may
branch on (see [Steps](./steps.md#choosing-a-method)). Today a script reads one with `h.read`. A few helpers would
normalize the common ones. A fact helper only reads something no step can change:

| Helper         | Reads             | Returns                                                                           |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| `arch(h)`      | `uname -m`        | Node's `process.arch` names, like `"x64"` and `"arm64"`                           |
| `platform(h)`  | `uname -s`        | Node's `process.platform` names, like `"linux"` and `"darwin"`                    |
| `osRelease(h)` | `/etc/os-release` | `{ id, idLike, versionId, versionCodename, prettyName }`, or `undefined` on macOS |

```ts
import { arch } from "tsinfra/facts"

const cpu = await arch(h)
await h.ensure("Install the arm build", { want: true, check: "...", fix: `... ${cpu} ...` })
```

- **Each takes `h` and runs at the top level only.** A helper is an ordinary `h.read` with the
  normalizing added, so it shows as its own `·` line in `--verbose`, the same as a helper a script writes itself. A step
  uses the fact through the closure, as above. Calling a helper inside a step's function fails the host with
  `'read' can't run while ensure step 'X' is running`, like any other call on `h` there.
- **There's no hidden way to run commands.** A helper that reached the shell around `h` would skip the session recorder
  and the failed-host check, and would follow rules a script's own helpers can't.
- **The value is in the normalizing.** `uname -m` prints `x86_64` or `aarch64` on Linux and `arm64` on macOS, and
  download URLs want `amd64` or `x64`. Node's names give the host the same vocabulary as the control machine. If a step
  ever needs the normalizing inside its function, the pure part can be exported too, like
  `toNodeArch(await read("uname -m"))`.
- **`os-release` covers every current Linux** through one standard file, with no per-distribution cases.
- **No fact system.** pyinfra has fact classes with a command and a parser, `host.get_fact`, a cache, and defaults for a
  missing command. tsinfra leaves those out, because a fact read once at the top of a script is just a `const`. A
  missing command is already an answer through `inspect`.
- **No facts about state a step manages,** like whether a file exists, a package is installed, or a command is on the
  `PATH`. Those belong in a step's check, where `plan` reads them at the right time. A `hasCommand` helper would invite
  the wrong shape from [Steps](./steps.md#choosing-a-method), an `inspect`, an `if`, and a `run`, instead of an
  `ensure` with `check: "command -v docker"`. A prerequisite nothing in the script installs is checked with
  `h.inspect` and a `throw` (see [Needs](./needs.md#a-prerequisite-nothing-in-the-script-installs)). pyinfra's docs warn about the same thing: "Only use
  immutable facts in deploy code (installed OS, Arch, etc)".
- **Container detection is left out** until a port needs it, because it differs across Docker, LXC, and systemd.

Build them once the Mac and container ports show which facts the scripts actually branch on.

### Sending data to a command

A command's stdin is `/dev/null`, because the script itself travels on stdin (see
[Transport](./transport.md#commands-travel-on-stdin)). A script has no clean way to hand a command data from the control
machine, like a binary built locally, or an image for `docker load`. `exec` can carry the data inside a hand-written
base64 heredoc, but that is the multi-line shell this design avoids. The same gap stops a fix from writing a file,
because `h.file` inside a fix is a step inside a step.

The likely answer is an `input` option on the tools, next to `maskOutput`, sent to the command's stdin:

```ts
await exec("docker load", { input: imageTarball })
```

A command that only takes a path gets the data written to a file first:

```ts
const tmp = await exec("mktemp")
await exec(`cat > '${tmp}'`, { input: dump })
await exec(`restore-tool --file '${tmp}'`)
```

How the data travels should follow how `file` sends content, base64 in a heredoc (see
[Transport](./transport.md#file-writes)). Add it when a port needs it.

### Following symlinks in `file`

`file` refuses a path that is a symlink, so it never replaces a link with a regular file, or writes somewhere the
script didn't name (see [Steps](./steps.md#file)). Making a link is [`link`](./steps.md#link)'s job. This question is
only whether `file` should follow an existing link and write to its target instead. The tools split on
this. Chef writes through the link to its target, and Ansible makes it an option. Following links would mean the file details script
resolves the real path first and reports it, and the write goes there. Decide when a port needs to manage a file that
is reached through a symlink.

### Files over 10 MB

`file` sends content in a base64 heredoc inside the write script, which the shell holds in memory before it runs, and
base64 adds a third. That is fine for config files, so content over 10 MB is refused (see [Steps](./steps.md#file)).
A `Blob` from `Bun.file` already offers `stream()`, so a streaming path could read the local file in chunks too.
Every agentless tool uses SFTP or scp instead, which streams. A streaming path for large files would upload with `scp`
to a temp file in the destination's directory as the SSH user, which works without `sudo`. With `sudo`, it needs a
user-writable place and a root `mv`, the two-hop step the heredoc avoids. Add it when a port needs a large file.

### `fsync` before the rename

The write doesn't `fsync` the temp file before the rename (see [Transport](./transport.md#file-writes)). After a crash
at the wrong moment, the file could be in place but empty. Puppet and Salt `fsync`, and Ansible and Chef don't.
`sync "$tmp"` would add it, but busybox ignores the argument and flushes everything. Add it if a host turns out to lose
power or crash often enough to matter.

### Backups of replaced files

Chef, Puppet, Ansible, and Salt can each keep a copy of the file they replace. tsinfra doesn't, because the script in
version control is the record of what a file should be, and `plan` shows the diff before anything changes. Revisit if a
port manages files that something else on the host also edits.

### Steps side by side within a host

Steps on one host run one at a time, and a step that starts while another is running fails the host (see
[Steps](./steps.md#commands)). That is how the session knows which step a command belongs to, with one variable for the
current step. Running steps side by side is not worth supporting yet:

- **Order usually matters.** You install before you configure, and the plan reads the same way on every run.
- **The slow steps tend to collide.** Two `apt-get install` steps fight over the dpkg lock.
- **Most of the waiting is across hosts,** which `--parallel` will cover.

Commands inside one step can already run at once, with `Promise.all` over `exec` in a fix. If a host ever needs steps
side by side, `AsyncLocalStorage` from `node:async_hooks` can track the current step for each async chain instead of
one variable for the host.

## Ideas

Features other tools have that could fit tsinfra, from a survey of pyinfra, Ansible, Salt, Chef, Puppet and Bolt,
cdist, Rex, Nix with home-manager and nix-darwin, mgmt, chezmoi, dotbot, yadm, Comtrya, Fabric, Pulumi, and Terraform
with OpenTofu, in November 2026. None is decided.

### Helper families

Shipped as subpath exports once two hosts use one the same way (see
[Helpers worth shipping](#helpers-worth-shipping)):

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
- **`tsinfra/docker`:** container helpers, starting with the `want: []` `ensure` that keeps running containers on the
  newest images (see [Recipes](./recipes.md#running-the-latest-container-images)), if the Docker container ports repeat
  it.
- **A run-once marker,** like chezmoi's `run_once_`: save a hash of the command in the
  host's [saved state](#open-changes), and check for it.
- **A 1Password reader,** like chezmoi's `onepasswordRead`: run `op read` with Bun `$` on the control machine and pass
  the value to `file` with `secret`. Every `plan` has to read the secret to compare it, so every plan prompts.

### Maybe later

Opt-in features with no real case yet:

- **`--json`** writes the report as one JSON document on stdout instead of the text blocks, for scripts and CI. It
  would serialize each host's record (see [CLI](./cli.md#what-a-host-records)), with each error as its message chain,
  and a version field so the shape can change later. Terraform's rule for that field works: readers ignore fields they
  don't know, and refuse a major version they don't support. No library is needed. Diagnostic logs stay on stderr
  either way, so stdout is only the document. Add it when something needs to read the output.
- **A shell-quoting helper,** exporting the `quoteShellArg` tsinfra already uses for its own commands. A list of values
  whose shape isn't fully trusted could then go into a command's text safely, like
  `` `apt-get install -y ${missing.map(quoteShellArg).join(" ")}` ``, which `env` doesn't handle well, because a
  variable holds one string. It adds to the public API, so add it when a script needs it.
- **`tsinfra exec <host> -- <cmd>`** runs an ad-hoc command on a host's target without its script, like
  `pyinfra INVENTORY exec`.
- **`--fail-fast`** stops starting new hosts once one fails, like Ansible's `any_errors_fatal` and Salt's `failhard`.
  With `--parallel 1`, it works as a canary rollout.
- **`apply --confirm`** plans, prints the report, asks, then applies, like Terraform's `apply` prompt.
- **Retries on a fix,** like Ansible's `until`, Salt's `retry`, Chef's `retries`, and pyinfra's `_retries`. A `retry()`
  helper inside the fix may be enough.
- **`backup` on `link`,** for the first dotfiles run, where real files sit where the links go. home-manager's `-b`
  moves them aside and aborts if the backup already exists. If backups come back for `file`, Puppet's same-folder copy
  with an extension is the lightest model (see [Backups](#backups-of-replaced-files)).
- **`env` on a tool call,** for a value that only exists inside a step's function, like a container ID from one
  `exec`, which goes into the next command's string today. Add it if a port needs one.
- **An argument list as a command,** like `exec(["tar", "-xzf", name])`, rendered by quoting each element with
  `quoteShellArg`. It's safe for any value, with no variable to name, like Ansible's `command` module and Chef's array
  form of `execute`. Pipes, redirects, and `$VAR` don't fit it, so it would sit beside command strings, not replace
  them. Add it if the ports show many commands built from values, where `env` feels heavy.
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
  will drop it too, so the two can share that code. Until then, use `sudo`, or `sg <group> -c '...'`.
- **Log in with an SSH password,** like Ansible's `--ask-pass`. Today `BatchMode=yes` stops ssh from prompting, so a
  host that only takes a password fails in preparation with ssh's `Permission denied (publickey,password)`. ssh can ask a
  helper instead of the terminal, with `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4 and later), the same
  way sudo's askpass works. The helper runs on the control machine and prints a variable, so it holds no secret. Only
  the connection that opens the ControlMaster logs in, so a host needs the password once per run. It fits the sudo
  prompt's flow: `buildHostDetails` stops a host whose `Permission denied` lists `password`, then `finishHostDetails`
  prompts for it, opens the connection, and goes straight on to sudo, prompting for that too if needed. Each host's
  prompts come together, one host at a time. A key's passphrase would come through the same helper, and ssh's prompt
  text tells the two apart.
- **A `path` host option,** a list of directories prepended to `PATH` in every command, like pyinfra's `_env` and
  Ansible's `environment`, but only for PATH. It covers the case the `shell` option is for, a tool installed outside
  the default PATH, like Go's. It has none of a login shell's pitfalls (see [The `shell` host option](#the-shell-host-option)).
  - **How it works:** a transport wrapper, like the one that adds the `sudo` function, starts each script with
    `PATH=<entries>:"$PATH"` and `export PATH`. It wraps each command after the recorder has seen it, so the record shows the script as written.
  - **Under sudo:** sudo resets PATH to its `secure_path`, so a `sudo: true` step gets the same line inside its nested
    shell. A `sudo` command inside a script still gets sudo's own PATH.
  - **Entries:** an entry must be absolute or start with `~/`. A `~/` entry resolves against the home directory that
    preparation reads, like `file`'s paths. An entry can't hold `:`, because PATH splits on it.
  - **Why not `env`:** a step's `env` sets literal values for that one step, so it can't extend `PATH`. `path` would
    prepend to it in every command on the host.
- **A manual step,** for work no command can do: pressing a pairing button, a login URL from `tailscale up`, an App
  Store sign-in for `mas`, or a macOS permission like Full Disk Access. It's shaped like `ensure` with instructions in
  place of a fix, like `h.manual(name, { want, check, instructions })`. `plan` shows the instructions under `~ change`.
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
  run in parallel. The cost is that these prompts come mid-run, not in preparation, so prompts from parallel hosts take
  turns and the live progress area pauses while one is open.

### Removed resources

The lowest priority here, and probably never built. A step the script stops managing leaves its file, link, or package
on the host, because there is no state file (see [No state](./README.md#no-state)). tsinfra doesn't track this, and
the automatic approaches are in [Rejected](#rejected). What's left:

- **Turn a step into its removal instead of deleting it.** This is the recommended pattern, and it needs no new feature
  (see [Recipes](./recipes.md#turn-a-step-into-its-removal-instead-of-deleting-it)). A step deleted without this leaves
  what it made on the host.
- **A manifest of `file` and `link` paths on the host,** kept in the host's [saved state](#open-changes), where `plan` only
  warns about paths in it that the script no longer manages. The machine stays the only source of truth. A path is the
  one thing that identifies a step across edits, so this list can be accurate. It wouldn't cover anything done through
  `ensure`. Add it only if a port shows that forgotten files are a real problem.
- **A full set whose contents can be listed.** A helper can find the extras in a set the script declares completely.
  nix-darwin's Homebrew `cleanup` is `none`, `check`, `uninstall`, or `zap`, and Salt's `file.directory` with
  `clean: True` and chezmoi's `exact_` folders delete every entry the run didn't declare. A managed folder's `plan` must
  list every file it would delete.

## Rejected

Recorded so the survey doesn't need redoing:

- **A run that reports nothing changed,** like Ansible's `changed_when` and Salt's `stateful` scripts, as a run function
  returning `{ changed: false }`. Its case, pulling images and recreating containers only when one is new, is an
  `ensure` on "the running containers are on the newest images", with a read-only check and `want: []` (see
  [Recipes](./recipes.md#running-the-latest-container-images)). The run version only made sense because it let the pull
  sit where a read-only check belongs, and its `plan` showed a change every time.

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
  data, so an `ensure` covers it, including its mode and owner (see
  [Recipes](./recipes.md#a-directory-with-ensure)). A helper can handle what differs on macOS and quote the path.

- **Tags, targeting, and `--start-at-task`.** Tags are a non-goal, and idempotent steps make starting partway pointless.
- **`block`/`rescue`, `ignore_errors`, and continuing past a failure.** A failed host stays failed, and `inspect`
  handles an exit that isn't an error.
- **State-file features:** saved plans, `moved` blocks, refresh-only, generations, and rollback. Rollback is a git revert
  and an `apply`.
- **Closing [open changes](#open-changes) by hand,** like a flag that deletes them without firing their runs. Open
  changes exist so nobody has to fix a host by hand. A clean apply closes them anyway, at the cost of a run that's safe
  to repeat.
- **Guards like `only_if`, `not_if`, `creates`, and `unless`.** `ensure`'s check covers them, and Chef's own docs show
  guards make why-run inaccurate.
- **Delegation and `local_action`.** The script already runs on the control machine.
- **Plugin systems for output.** JSON output covers what a reader needs.
- **Fact caching and fact systems.** See [Fact helpers](#fact-helpers).
- **Vaults and encrypted files in the repo.** TypeScript can call sops or a password manager directly.
- **Reading every step's state before any fix,** like cdist's stages and pyinfra's prepare phase. It decides on state
  that's stale by the time the fix runs.
- **Delayed, deduplicated notifications.** A run after both steps with `after: [a, b]` already fires once.
- **Async tasks.** They have no check mode, and SSH keepalives cover long commands.
- **Real-time watching,** like mgmt. A daemon is the full config tool tsinfra isn't.
- **Second languages for plans,** like Bolt's YAML plans and cdist's file-per-parameter types.
