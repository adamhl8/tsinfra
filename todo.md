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
2. **Steps.** `step` (both check kinds), `run`, `read`, plan and apply modes, verification, and failure marking the
   host so later calls are skipped.
3. **`file`.** The GNU and BSD check command, the local hash, diffs (text, binary, secret), the temp-file write.
4. **Requirements.** `need`, `requires`, `provides`, waiting in plan, and the wrong-order message.
5. **CLI.** Discover `hosts/`, run hosts in parallel, hold output per host, the summary, and exit codes.

## Port

6. **The Mac.** Port `~/homelab/pyinfra/macbook` to `hosts/macbook.ts`, with its helpers in `~/homelab/lib`. Compare
   `tsinfra plan` against `just plan macbook` on the same machine. This settles the plan output question and the
   interactive sudo question.
7. **Two simple containers.** flaresolverr and byparr, the ones the homelab todo already marks as the place to start.
   Then sonarr, which needs a systemd unit and a requirement.
8. **Revisit the open questions** with those ports as evidence, and decide which helpers move into tsinfra.
