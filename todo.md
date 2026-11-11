# todo

What's left before tsinfra can run the homelab, in order, then the ports that decide the
[open questions](./docs/open-questions.md). Each stage is usable on its own.

## Next

1. **SSH transport.** The local transport, the `{ ... } </dev/null` wrapper, and the `sudo` preamble are done. The rest
   comes in seven pieces, each reviewed before the next (see [Transport](./docs/transport.md#ssh-and-controlmaster)).
   Pieces 3 to 5 clean up how a host's failures are recorded and reported, before SSH goes further:
   1. **Plain SSH.** `ssh -T` with commands on stdin to `sh -s`, the ControlMaster options with `BatchMode`, ssh's own
      exit 255 as a failure to run, one retry on a connection closing as a command joins it, and `ssh -O stop` at the
      end of the run. Integration tests against a real sshd in `bask test-docker`. Test a command that can't run after
      the session starts, like sshd going away mid-run: it fails the host, and the step's record keeps the command and
      its error.
   2. **`ssh -G` defaults.** Preparation reads the host's effective settings, then passes `accept-new`,
      `ConnectTimeout=10`, and `LogLevel=ERROR` only where the config says nothing, with the hints for a new host and a
      changed key.
   3. **The failure kinds in the report.** Four kinds: a startup failure stops the run before any host exists (a bad
      flag, no `hosts/` directory, a host script that won't load), a preparation failure stops one host while it's
      prepared, a host function failure is anything thrown during the host function that no step owns, and a step
      failure belongs to a step. A preparation failure shows as `(preparation) <target>`, and a host function failure as
      `(host fn) <target>` with a note, in place of today's `(host) a.ts`. Write the four kinds down in the docs.
   4. **The host's record and its recorders (built).** One record per host, not one per run, because hosts will run in
      parallel, and the report reads it. The package `session/recorder/` holds `records.ts` (every record type, and
      `createHostRecord`), `commands.ts` (`createRecordingTransport(transport, addCommand)`), `failure-hints.ts`, and a
      recorder per stage of the run, both writing to the same `HostRecord`, with `recorder.ts` re-exporting them.
      - **The record.** `HostRecord` is `{ name, target, preparationCommands, stepRecords, failure? }`, and `runHost`
        returns it in place of `HostReport`. Every `HostEntry` carries it, beside its `loadedHost`, and an optional
        `sessionContext` that's unset when preparation failed. The session never holds it. `failure` is the host's one
        `RecordedFailure`: a
        `RecordedUnownedFailure { kind: "preparation" | "host fn", error, hints }`, or a
        `RecordedStepFailure { kind: "step", stepRecord, error, hints }`. A failed step has no status, and the report
        shows the failure after the steps, because the step that failed is always the last.
      - **The preparation recorder.** `createPreparationRecorder(hostRecord)` gives `getShell(transport)`, a shell
        that records onto `preparationCommands`, and `recordFailure(error)`, which sets the `preparation` failure with
        its hints. `buildHostDetails(loadedHost, preparationRecorder)` builds the control machine shell, gets the base
        transport from `prepareBaseTransport(localShell, target)`, then builds the host shell on it, which
        `HostDetails.hostShell` carries to `finishHostDetails` for the prompt's password checks. The sudo password
        check records `<sudo password>` through `recordedCmd`, checked in Docker with real sudo, and locally through
        the prompt fixture's `--records`.
      - **The session recorder.** `createSessionRecorder(hostRecord, hostOptions, transport)` takes the host's final
        transport and keeps it to itself, behind `getShell({ sudo })`, which records under the running step above the
        root transport. So nothing in the session can run a command off the record. It also holds the step recording
        (`startStep`, `finishStep`, `failStep`, `convergeRecorder`) and the session's failure rules: `recordFailure`
        keeps the first error and creates `host fn` failures, and a step claims any failure from while it ran, with
        hints from its commands. `getFailure()` gives the session the host's error. `SessionContext` is
        `{ name, home, sessionRecorder }`, built when preparation hands off, and `createHostSession` returns the `Host`.
      - **Tests.** `createWrappedSession` gives a session a second session recorder on the same record, over a wrapped
        transport. Callers that prepare outside `prepareHosts` pass a plain, unrecorded shell, or a recorder of their
        own.
   5. **Preparation commands on the host record.** Preparation already records through the preparation recorder's shells, so
      this gives each command a label: `ssh -G`, the home and user reads, the sudo checks, and the askpass helper
      write. The transport's own mechanics stay off the record, because they belong in the diagnostic log: the
      `{ ... } </dev/null` wrapper, the `sudo` function line, the `ssh` process around each command, the retry when a
      connection closes, and the end of the run's `ssh -O stop` (decided 2026-11-10, in place of recording it on each
      host that used that target).
      - **One hint function (built).** `getFailureHints(target, hostOptions, commandRecords)` in
        `session/recorder/failure-hints.ts` reads the stderr of each command that exited non-zero, and the message of
        each that failed to run, which is where ssh's stderr lives. Both recorders call it: the preparation recorder
        with `preparationCommands`, and the session recorder with the failed step's commands. So the host-key hints and
        the sudo hint apply in either stage.
   6. **The `shell` host option.** `{ shell: "bash -l" }` starts `bash -l -s` in place of `sh -s`, on both transports.
   7. **The cross-shell tests.** The file write rule on dash, bash, and busybox sh over SSH, and on macOS `/bin/sh`,
      which runs only on darwin, so it is local only. The sudo password flows already work over any transport, so they
      need only a test over SSH.
2. **Verbosity levels.** `-vv` lists each step's commands, with labels for tsinfra's own, and `-vvv` adds their output
   (see [CLI](./docs/cli.md#output)). A failure's note already tells people to run with `-vvv`, so `-vvv` has to show the
   stderr that note promises. A command that `sudo: true` ran as root gets a `sudo` boolean on `CommandRecord`, set in
   `createStepShell`, because the record holds the script without the `sudo sh -s` around it. The report shows it as a
   tag, not as the wrapped command.

## Port

3. **The Mac.** Port `~/homelab/pyinfra/macbook` to `hosts/macbook.ts`, with its helpers in `~/homelab/lib`. Compare
   `tsinfra plan` against `just plan macbook` on the same machine. This settles the plan output question, and
   tries the sudo prompt from `file` part 6 on a host without passwordless sudo.
4. **Two simple containers.** flaresolverr and byparr, the ones the homelab todo already marks as the place to start.
   Then sonarr, which needs a systemd unit and a `needs`.
5. **Revisit the open questions** with those ports as evidence, and decide which helpers move into tsinfra.

## Later

Decided, and wanted eventually, with no place in the order yet.

- **Reboot.** `h.reboot({ after, timeout })`: the boot id read before and after, `sudo reboot` started in the
  background, the ControlMaster socket dropped, polling until the host answers, and `@local` refused (see
  [Steps](./docs/steps.md#reboot)). It needs SSH. The Incus host needs it after a kernel change, and until then it
  reboots by hand.
- **Running hosts in parallel.** Up to `--parallel <n>` at once, with each host's output held until it finishes, and the
  live progress area under the finished blocks (see [CLI](./docs/cli.md#live-progress)).
- **Diagnostic logs.** LogTape on stderr, with `@optique/logtape` adding its options to the CLI (see
  [CLI](./docs/cli.md#diagnostic-logs)).
- **Tasks.** `task(name, fn)`, registered with `host(target, fn, { tasks: [...] })`, and `--task <name>` on `plan` and
  `apply`, running only hosts that have it (see [CLI](./docs/cli.md#tasks)).
- **Ordering between hosts.** `needs` on `host()`, taking imported host scripts. The design is tentative, and it comes
  after `--parallel` and most of the rest of this file (see
  [Open questions](./docs/open-questions.md#ordering-between-hosts)).

## Follow-ups

- **Stop remote commands on Ctrl-C.** Without a terminal, Ctrl-C ends the local `ssh`, but the command on the host
  keeps running. nixos-rebuild runs a remote `pkill -SIGINT` when it's interrupted. tsinfra needs the same, with the
  process to stop known, and the run's connections still closed.
- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after
  that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the
  wrong step. `callStep` already builds a fresh set of tools for each step. What's left is to bind them to the step's
  record, and fail the host through `callOrFail` when that step is no longer the running one. Do not throw in
  `recordCommands`, because only `session.ts` throws, and a throw there would skip recording the failure in
  `callOrFail`.
- **A recipes section in the user docs.** When the full docs get written, add a cookbook of patterns that need no
  tsinfra feature. Start with these:
  - **A template is a function** in its own `.ts` file, which gives typed parameters, plain loops and conditionals, and
    a template that tests can call:

    ```ts
    // files/caddyfile.ts
    export const caddyfile = (site: { domain: string; port: number }) => `${site.domain} {
      reverse_proxy localhost:${site.port}
    }
    `

    // hosts/sonarr.ts
    await h.file("/etc/caddy/Caddyfile", caddyfile({ domain: "sonarr.lan", port: 8989 }), { sudo: true })
    ```

    A template literal inside indented code keeps that indentation, so keep templates at the top level of their file,
    or use [`dedent`](https://www.npmjs.com/package/dedent) or `outdent` inline. Someone porting Jinja files can render
    them with Nunjucks and pass the output as a string.

  - **Paths on the control machine** with `import.meta.dir` in a `lib/paths.ts` (see
    [Steps](./docs/steps.md#file)).
  - **An idempotence check:** in a container, `apply`, then `plan` expecting exit 0 (see
    [Ideas](./docs/ideas.md#decided)).
  - **Checking a whole config with `run`:** a fragment that only makes sense with the rest of a config is checked after
    it's in place, like `h.run("Reload nginx", "nginx -t && systemctl reload nginx", { after: [site] })`. A `run` with
    `after: "always"` that runs `sshd -t` checks the live config on every `apply`, which catches a config that a new
    version of the tool no longer accepts. `validate` is for a file that must never be broken, even for a moment.
  - **Removing a path with `ensure`:** check `test -e path || test -L path` with `want: false`, because `test -e` is
    false for a dead link, so a check with `-e` alone never removes one.
  - **A directory with `ensure`.** When only its existence matters, check `test -d path` with `want: true`, and fix with
    `mkdir -p path`. When its mode or owner matters too, compare them as a string:

    ```ts
    await h.ensure("Create /srv/sonarr", {
      check: "test -d /srv/sonarr && stat -c '%a %U %G' /srv/sonarr",
      want: "750 sonarr sonarr",
      fix: "sudo install -d -m 750 -o sonarr -g sonarr /srv/sonarr",
    })
    ```

    A missing directory gives empty output, which doesn't match `want`, so the fix runs. The `test -d` stops a regular
    file with the same mode and owner from looking correct. `stat -c` is GNU only, and macOS needs `stat -f`, so a
    helper is worth writing for a script that manages many directories or runs on both.

  - **Turn a step into its removal instead of deleting it.** A deleted step leaves what it made on the host, and tsinfra
    can't know how to undo it (see [Ideas](./docs/ideas.md#removed-resources)). Edit the step, and delete it once every
    host has applied it. Name each direction, because a boolean check shows no values under its `~` line. A function
    keeps both directions side by side:

    ```ts
    // lib/docker.ts
    export const docker = async (h: Host, { present }: { present: boolean }) =>
      h.ensure(present ? "Install Docker" : "Remove Docker", {
        check: "command -v docker",
        want: present,
        fix: present ? INSTALL_DOCKER : REMOVE_DOCKER,
      })

    // hosts/sonarr.ts
    await docker(h, { present: false })
    ```

  - **An empty `want` for "nothing left to do".** When the fix should run only while there's something to act on, like
    images with a newer version, packages to upgrade, or files out of place, the check returns the list of those things
    as lines, and `want` is `""`. The fix runs only when the list isn't empty, `plan` shows exactly which ones as a
    diff from nothing, and the check after the fix confirms the list emptied. A boolean would only say "something".
  - **Running the latest container images,** as an empty-`want` `ensure`. The check reads the registry's digest without
    pulling, and compares it with the image each running container started from, because pulling in a check breaks the
    rule on what a check may change (see [Steps](./docs/steps.md#what-a-check-may-change)). The exact `docker` commands get confirmed when this is
    written:

    ```ts
    await h.ensure("Run the latest images", {
      check: async ({ read }) => {
        const outdated: string[] = []
        for (const { service, image } of services) {
          const remote = await read(`docker buildx imagetools inspect ${image} --format '{{.Manifest.Digest}}'`)
          const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
          if (!(await isSameImage(read, running, remote))) outdated.push(service)
        }
        return outdated.join("\n")
      },
      want: "",
      fix: "docker compose pull && docker compose up -d",
    })
    ```

    `plan` shows a change only when a newer image exists, naming the services. It reads the registry on every plan, one
    manifest request per image, which Docker Hub doesn't count against its pull limit.

    **Use with caution: pulling in the check.** It's simpler, and it breaks tsinfra's rule that `plan` changes nothing
    the script manages. Every `plan` pulls, which moves each image tag on the host, so a `docker compose up -d` run by
    anything afterwards starts the new image, even though nothing was applied. Every plan also downloads, and counts
    against Docker Hub's pull limit, which an hourly drift check can reach. Use it only if those costs are fine for
    this host:

    ```ts
    await h.ensure("Run the latest images", {
      check: async ({ read }) => {
        await read("docker compose pull")
        const outdated: string[] = []
        for (const { service, image } of services) {
          const pulled = await read(`docker image inspect --format '{{.Id}}' ${image}`)
          const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
          if (pulled !== running) outdated.push(service)
        }
        return outdated.join("\n")
      },
      want: "",
      fix: "docker compose up -d",
    })
    ```

  - **A reboot before `h.reboot` exists,** as an `ensure` after the steps that need it. The check reads the state only
    a reboot brings, and the fix schedules the reboot and fails the host on purpose:

    ```ts
    await h.ensure("Reboot to load ZFS", {
      check: "test -e /sys/module/zfs",
      want: true,
      fix: "sudo systemd-run --on-active=5 systemctl reboot && echo 'rebooting, rerun in a minute' >&2 && exit 1",
    })
    ```

    `systemd-run` delays the reboot, so the command returns before the connection drops. The failure skips the rest of
    the host's steps, and the next run starts past this one, because the check passes after the reboot. `plan` shows
    it as a change, which a bare `throw` in the script wouldn't. For a kernel update, compare `uname -r` with the
    newest `/boot/vmlinuz-*`. The same shape works as a pause for a manual login, with a fix that only fails with
    the instructions, like `ssh in and run 'ob login'`.

  - **A config file an app owns,** like Sonarr's `config.xml`, which it creates on first start and rewrites when a
    setting changes in its UI. Seed it before the first start with `overwrite: false`, so the app starts with your
    values, then manage each value you care about with its own `ensure`:

    ```ts
    const configPath = "/home/adam/.sonarr/config.xml"
    await h.file(configPath, `<Config><Port>8000</Port><ApiKey>${sonarrApiKey}</ApiKey></Config>\n`, {
      secret: true,
      overwrite: false,
    })
    await h.ensure("Set Sonarr's port", {
      check: `grep -o '<Port>[0-9]*</Port>' ${configPath}`,
      want: "<Port>8000</Port>",
      fix: `sed -i 's|<Port>[0-9]*</Port>|<Port>8000</Port>|' ${configPath} && sudo systemctl restart sonarr`,
    })
    ```

    The seed avoids waiting for the app to create the file, and puts an API key from sops in place before anything
    reads it. An app that writes its whole config when it stops, like qBittorrent, needs the fix to stop it, edit,
    then start it, or the app's copy overwrites the edit.

  - **A directory of files,** like a built static site, as one `file` step per file, from a loop over the local
    directory:

    ```ts
    import path from "node:path"

    import { Glob } from "bun"

    const siteDir = path.join(import.meta.dir, "../site/dist")
    for await (const relativePath of new Glob("**/*").scan({ cwd: siteDir })) {
      await h.file(`~/dist/${relativePath}`, Bun.file(path.join(siteDir, relativePath)))
    }
    ```

    `file` creates missing parent directories, and an `ensure` sets a directory's mode when it matters (see the
    directory recipe above). A file removed from the local directory stays on the host, so remove it with its own step,
    or rebuild the directory.

  - **A value from your own environment in a `sudo` command.** `sudo` resets the environment, and Debian's
    `secure_path` replaces `PATH` even with `sudo -E`. Read the value as yourself first, and put `sudo` only on the part
    that needs root:

    ```ts
    fix: 'fish_path="$(command -v fish)" && echo "$fish_path" | sudo tee -a /etc/shells && sudo chsh -s "$fish_path" "$USER"'
    ```

    `command -v fish` runs with your `PATH`, and the variable expands before `sudo` sees it, so root's `PATH` never
    matters.

- **A comparison table in the user docs.** When the full docs get written, add a table of how tsinfra compares with other
  config tools, led by its strengths. What the survey in [Ideas](./docs/ideas.md) found so far:

  |                      | tsinfra                                                                     | Others                                                                                                                                                                                                                             |
  | -------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Needs on the host    | `sh` and `sshd`                                                             | Ansible needs Python, except `raw`, which has no check mode or diff. salt-ssh needs Python 3 and sends a "thin" tarball. Chef's agentless mode is Linux only, and Bolt's `apply` installs the Puppet agent. cdist matches tsinfra. |
  | When state is read   | Just before each step's fix, and again after it                             | pyinfra reads facts in a prepare phase before any change, and its docs warn they go stale. cdist runs every explorer before any code.                                                                                              |
  | How honest `plan` is | A step that depends on a change waits with `needs`, and follow-up runs show | Chef calls its own why-run mode "harmful" because it can only forecast. Ansible modules without check-mode support report nothing. Puppet's noop skips refreshes.                                                                  |
  | Order                | Top to bottom, as written                                                   | Puppet orders by a graph. cdist's order is undefined without dependencies.                                                                                                                                                         |
  | Reacting to a change | Typed `changed` results passed to `after`                                   | Ansible handlers run at the end of the play. cdist types grep message files.                                                                                                                                                       |
  | Language             | TypeScript, with typed options and template literals                        | YAML, DSLs, or shell scripts with a file per parameter                                                                                                                                                                             |
  | State file           | None                                                                        | Same as Ansible and pyinfra. Terraform needs one because it creates resources.                                                                                                                                                     |

- **Hint on a failed triggered run.** When a run with `after` fails, end its error with a hint that the steps it follows
  won't show as changed on the next apply, so it needs a manual rerun once fixed (see [Steps](./docs/steps.md#run)).

## Done

- **Steps.** `ensure` (both check kinds), `run`, `read`, plan and apply modes, verification, and failure marking the
  host so later calls are skipped.
- **`file` parts 1 to 7,** each reviewed before the next (the design is in [Steps](./docs/steps.md#file) and
  [Transport](./docs/transport.md#file-writes)):
  1.  **Reading the state and the plan output.** The GNU and BSD file details script, the local hash, the `file` comparison, the
      content diff and its notes (new, secret, binary, large), the `mode: 644 -> 600` attribute lines, path quoting, and
      `~/` resolved as the SSH user.
  2.  **The write.** In six pieces, each reviewed before the next:
      1. **The signature.** `content` as `file`'s second argument, with every option optional, and a `Blob` like
         `Bun.file(...)` accepted as content, read inside the step.
      2. **The write script and verification.** The write script in its tested order, and verification after it. Now that
         `file` can fail with "still differs", replace the hand-built record in `format.test.ts` that checks labelled
         commands stay out of the stderr rule with a real run.
      3. **Sudo.** `sudo` in the shell and transport for tsinfra's own commands.
      4. **The size limit.** Content over 10 MB fails before anything is sent.
      5. **The symlink refusal.** The file details parser already refuses a symlink in `plan` and `apply`. What's left is a
         test that `apply` refuses one without writing.
      6. **The errors without `sudo`.** An error for `user` naming another user. The error for an unreadable file is
         already built.
  3.  **Links.** In two pieces, each reviewed before the next:
      1. **The `link` step** (see [Steps](./docs/steps.md#link) and [Transport](./docs/transport.md#link-writes)).
      2. **Warnings.** A `warning:` line under a step that worked but needs a look, which shows it even when it's
         already right, and a count in the summary (see [CLI](./docs/cli.md#how-the-report-is-built)). It starts with a
         link to a missing path.
  4.  **Docs and preview.** The preview shows each way a file or a link can look, and the docs for both match the code.
  5.  **Validation.** `validate` on `file`, run against the temp file before the rename, in a temp directory that keeps
      the destination's name (see [Steps](./docs/steps.md#the-write) and [Transport](./docs/transport.md#file-writes)).
  6.  **Sudo passwords.** In three pieces, each reviewed before the next (the design is in
      [Transport](./docs/transport.md#sudo)):
      1. **The option, the check, and askpass for a password given in `host()`.** `sudo?: true | { password }` on
         `host()`, the `sudo -n -k true` check in preparation, and the askpass preamble with `~/.tsinfra/askpass.sh` on a
         host given a password.
      2. **The prompt.** A `sudo: true` host whose sudo needs a password prompts for it in preparation, after every host
         is prepared, one host at a time in the hosts' order. Every password is checked with `sudo -k -S`, so a wrong
         one logs one failed try, and `readHiddenLine` reads it with `node:readline` muted.
      3. **The hint for a host that doesn't declare `sudo`.** Its `sudo` stays `sudo -n`. A host that leaves `sudo`
         off and fails after sudo's `a password is required` gets a hint under its failure in the report:
         `sudo needs a password on this host, so set the sudo option on host()`. The session decides it when the step
         fails, from the step's own commands and the host's option, and records it on the step, so errors keep sudo's
         own words. A non-English locale doesn't get the hint.

      SSH isn't built yet, so all three are tested against `@local` and in Docker. The flows are the same over SSH.

  7.  **Content written only once.** `overwrite: false` writes a missing file, and leaves an existing one alone, its
      mode and owner included. The comparison returns in sync for an existing file, so nothing else changes.

  The tests run on the platform they run on, so macOS covers the BSD paths. `bask test-docker` covers the GNU and
  busybox paths, and real `sudo` and root, in containers. Real SELinux labels need a VM with it enforcing.

- **Needs.** `needs` on `ensure`, `file`, and `link`, `name` and `kind` on `ChangeStepResult`, and waiting in plan.
- **CLI.** Discovering `hosts/`, the summary, and exit codes.
