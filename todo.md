# todo

Build order for the design in `docs/`. Each stage is usable on its own, and the ports at the end are what decide the
[open questions](./docs/open-questions.md).

## Housekeeping

- Make an initial commit. Nothing in the repo is committed yet.

## Build

1. **Transport.** Local and SSH, commands on stdin to `sh -s`, the `{ ... } </dev/null` wrapper, ControlMaster options,
   `sudo -n`, the `shell` host option. Integration tests against a real local shell and a real sshd. Test the file
   write rule on dash, bash, busybox sh, and macOS `/bin/sh`. The sshd and Linux shells run in Docker containers, and
   those tests skip when Docker is not available. The macOS `/bin/sh` case runs only on darwin, so it is local only.
   Test a command that can't run after the session starts, like sshd going away mid-run: it fails the host, and the
   step's record keeps the command and its error.
2. **Steps.** `step` (both check kinds), `run`, `read`, plan and apply modes, verification, and failure marking the
   host so later calls are skipped.
3. **`file`.** In four parts, each reviewed before the next (the design is in [Steps](./docs/steps.md#file) and
   [Transport](./docs/transport.md#file-writes)):
   1. **The check and the plan output.** The GNU and BSD check command, the local hash, the `file` comparison, the
      content diff and its notes (new, secret, binary, large), the `mode: 644 -> 600` attribute lines, path quoting, and
      `~/` resolved as the SSH user.
   2. **The write.** The write script in its tested order, verification, `sudo` in the shell and transport for tsinfra's
      own commands, the 10 MB limit, the symlink refusal, and the errors for `owner` or an unreadable file without
      `sudo`.
   3. **Links.** The `link` form: the `readlink` check, absolute targets only, `force` for a regular file, an error for
      a directory, the `points to a missing path` note, and a write that never follows an existing link to a directory.
   4. **Docs and preview.** Preview hosts for a content diff, a new file, attribute changes, a secret file, a binary
      file, and a link.

   The tests run on the platform they run on, so macOS covers the BSD paths. The GNU and busybox paths wait for the
   Docker containers in step 1. The `sudo` path can't run in tests, so its command line gets a unit test.

4. **Needs.** `needs` on `ensure` and `file`, `name` and `kind` on `StepResult`, and waiting in plan.
5. **CLI.** Discover `hosts/`, run hosts in parallel, hold output per host, the summary, and exit codes.

## Follow-ups

- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after
  that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the
  wrong step. Build the tools inside `callStep`, bound to the step's record, and fail the host through `callOrFail` when
  that step is no longer the running one. Do not throw in `recordCommands`, because only `session.ts` throws, and a
  throw there would skip `fail()`.

## Port

6. **The Mac.** Port `~/homelab/pyinfra/macbook` to `hosts/macbook.ts`, with its helpers in `~/homelab/lib`. Compare
   `tsinfra plan` against `just plan macbook` on the same machine. This settles the plan output question and the
   interactive sudo question.
7. **Two simple containers.** flaresolverr and byparr, the ones the homelab todo already marks as the place to start.
   Then sonarr, which needs a systemd unit and a `needs`.
8. **Revisit the open questions** with those ports as evidence, and decide which helpers move into tsinfra.
