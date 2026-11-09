# Transport

Two transports, local and SSH. Both run the same scripts the same way. The only difference is the command that starts
the remote shell.

<!-- toc -->

- [Commands travel on stdin](#commands-travel-on-stdin)
- [Login shells](#login-shells)
- [File writes](#file-writes)
  - [How other tools write files](#how-other-tools-write-files)
- [SSH and ControlMaster](#ssh-and-controlmaster)
  - [How other tools reach hosts](#how-other-tools-reach-hosts)
- [Link writes](#link-writes)
- [sudo](#sudo)

<!-- tocstop -->

```ts
export default host("sonarr.lan", async (h) => { ... }) // SSH, any target ssh accepts
export default host("@local", async (h) => { ... }) // the control machine itself
export default host("caddy.lan", async (h) => { ... }, { shell: "bash -l" })
```

`"@local"` is the same magic name pyinfra uses, and the one `~/homelab/pyinfra/inventory.py` already uses.

Any other target goes to `ssh` exactly as written, so it can name a user, like `adam@incus.lan`. Without one, ssh logs
in as the `User` that `~/.ssh/config` gives the host, or else as the local user. Each user gets its own connection.

## Commands travel on stdin

Every command is sent as a script on stdin to a shell on the host. The command that starts that shell is always a
fixed string:

```sh
ssh <options> sonarr.lan sh -s  # SSH
sh -s                           # local
```

A command that escalates says `sudo` inside the script, so the shell itself never starts under sudo (see [sudo](#sudo)).

The remote login shell only ever parses `sh -s`, so the content of a command never needs quoting for it. Whether that
login shell is bash or fish, nothing changes. This is the fix for the "three shells involved" quoting problem in
`~/homelab/archive/incus-update/utils.ts`.

The script is wrapped as `{ <script>\n} </dev/null`. The shell parses the whole group before running it, then runs it
with stdin from `/dev/null`. Without that wrapper, a command in the script that reads stdin (`apt` asking a question, a
nested `ssh`) would read the rest of the script as its input.

Output comes back as stdout, stderr, and an exit code. `ssh` itself exits 255 when the connection fails, so a 255
always gets the connection error from ssh's stderr rather than being treated as the command's exit code (see
[SSH and ControlMaster](#ssh-and-controlmaster)).

## Login shells

`sh -s` is not a login shell, so PATH additions from `.bashrc` or `.profile` do not load. The archived Bun scripts used
`bash -li` for exactly that (Go's path lives in `.bashrc` on the caddy container).

The host option `shell` replaces `sh` in the starting command, so `{ shell: "bash -l" }` runs `bash -l -s`. Generated
commands (`file`'s details script and write) are POSIX sh, so any `shell` must be POSIX compatible. fish is not.

## File writes

`file` writes with one script, run on the host by `sh -s`, and in a nested `sudo sh -s` with `sudo: true`. The content travels
inside the script, base64-encoded in a quoted heredoc, and lands in a temp file in a temp directory next to the
destination:

```sh
set -eu
mkdir -p '/etc/app'                                    # 1. parent directories, before the umask
umask 077                                              # 2. new files start private
tmp=$(mktemp -d '/etc/app/.app.conf.tsinfra.XXXXXX')   # 3. a unique temp directory next to the destination
trap 'rm -rf "$tmp"' EXIT                              #    removed if anything below fails
tmppath="$tmp"/'app.conf'                              #    the temp file keeps the destination's name
base64 -d > "$tmppath" <<'__TSINFRA_EOF__'             # 4. the content, decoded into the temp file
<content as base64>
__TSINFRA_EOF__
chown -h -- '1000:1000' "$tmppath"                     # 5. user and group first
chmod 644 "$tmppath"                                   #    then the mode
chcon --reference='/etc/app/app.conf' "$tmppath"       # 6. an existing file's SELinux label, when chcon exists
( <validate command>                                   # 7. the validate command, when there is one
) >&2 || { status=$?; echo validate=failed; exit "$status"; }
mv -f "$tmppath" '/etc/app/app.conf'                   # 8. one rename puts it in place
rm -rf "$tmp"
trap - EXIT
restorecon '/etc/app/app.conf'                         # 9. a new file's default SELinux label, when restorecon exists
```

Each step's place in the order matters:

1. **`mkdir -p` runs before `umask 077`,** so a parent directory it creates gets the usual permissions. After the
   umask it would come out `0700`, and a daemon that isn't root couldn't reach the file.
2. **`umask 077`** means the temp file exists only as private, so a secret is never readable while it is written.
3. **`mktemp -d` creates a private temp directory,** with a name nobody can predict. A fixed name could be a symlink
   someone planted, and writing to it would follow the link. The directory sits next to the destination, so the final
   rename stays on one filesystem and is atomic. The temp file inside it has the destination's own name, extension
   included, because some validators pick a parser by extension, and `mktemp` can only put its random part at the end
   of a name. `mktemp -d` exists on GNU, BSD and macOS, and busybox. `link` writes the same way (see
   [Link writes](#link-writes)).
4. **The heredoc** is part of the script, so the shell parses it before running anything, and the content arrives
   intact whatever the shell's buffering. The delimiter has underscores, which base64 never contains, so no line of the
   content can end it early.
5. **`chown` comes before `chmod`,** because `chown` clears setuid and setgid, even when root runs it. Chef and cdist
   both have comments about this. With no `user`, `group`, or `mode` given, the values come from the existing file, as
   the file details script found them, or the defaults for a new file. `chown` runs whenever there's a value, because
   the temp file's owner is whoever ran the script. So a write without `sudo` to a file owned by someone else is refused
   before it starts (see [Steps](./steps.md#sudo-and-permissions)), and never takes ownership away from an app. A new file with no `user` or `group` skips it.
   `chown` keeps its `--`, because a user or group name comes from the script. It takes `-h` too, because `link` shares
   this line, and `-h` changes nothing for a regular file. Paths need none, because they're always
   absolute.
6. **SELinux.** `mv` keeps the temp file's label, so the replacement takes the old file's label first. Both SELinux
   steps run only when the command exists, and a failure is ignored, because `chcon` can exist on a system with SELinux
   off, and then it fails.
7. **The validate command** checks the temp file once it has its final owner and mode, because `visudo -c` checks
   those too. It runs in a subshell, so an `exit` in it ends only the command. Its stdout goes to stderr, so the
   script's stdout holds only the `validate=failed` marker, which tells a failed validation apart from a failed write.
   The script exits with the command's own code, so the error shows it. The write runs through `shell.inspect`,
   because `exec` drops stdout on a failure.
8. **`mv -f`** is the only moment the destination changes, so it is always either the old file or the complete new one,
   already with its owner and mode.
9. **`restorecon`** gives a newly created file the label the policy expects. It skips an existing file, because it
   could reset a label that `chcon` just kept.

No step runs `fsync` before the rename. A crash at the wrong moment could leave the new file empty after a reboot.
Ansible and Chef skip it too, and Puppet and Salt don't (see
[Open questions](./open-questions.md#fsync-before-the-rename)).

The record never holds the content. It stores the script with `<content as base64>` in place of the heredoc's content,
because the content may be a secret, and it can be large.

An earlier draft streamed the raw bytes after the script and let `cat` read them. dash and busybox sh both read ahead on
stdin and swallow part of the content, so that only worked under bash and zsh. A 10 MB binary through the heredoc arrives
intact under dash, bash, busybox sh, zsh, and macOS `/bin/sh`.

### How other tools write files

Researched from the source of Ansible, pyinfra, Salt, Chef, Puppet, and cdist:

| Tool    | Hash                 | Transfer    | Temp file                                | sudo                       |
| ------- | -------------------- | ----------- | ---------------------------------------- | -------------------------- |
| Ansible | sha1, in Python      | SFTP or scp | `~/.ansible/tmp`, then a rename          | upload, then root moves it |
| pyinfra | sha1, md5, or sha256 | SFTP        | the destination, or `/tmp` then `cp`     | upload, then `sudo cp`     |
| Salt    | sha256               | agent       | destination's directory, `fsync`, rename | runs as root               |
| Chef    | sha256               | agent       | destination's directory, `mv`            | runs as root               |
| Puppet  | sha256               | agent       | destination's directory, `fsync`, rename | runs as root               |
| cdist   | `cksum` (CRC32)      | scp         | destination's directory, not atomic      | connects as root           |

Ansible applies the mode and owner after its rename, and falls back to the destination's directory when the rename
would cross filesystems. pyinfra writes straight to the destination without sudo, so its write isn't atomic there.
Chef sets the owner before the mode. Puppet sets the mode before its rename. cdist sets the mode last.

What tsinfra takes from them, and where it differs:

- **The hash, the temp file in the destination's directory, and owner before mode** match the careful tools.
- **Setting mode and owner on the temp file before the rename** follows Puppet. Ansible, Chef, Salt, and pyinfra apply
  them after, which leaves a moment where the file is in place with the wrong permissions.
- **The transfer differs.** Every agentless tool uses SFTP or scp. SFTP always writes as the SSH user, so for a
  root-owned file they upload to a user-writable place like `/tmp`, then a root command copies or moves it into place.
  That second hop is where pyinfra (a `cp`) and Chef (an `mv` across filesystems from `/tmp`) lose atomicity. SFTP's
  real advantage is streaming large files. tsinfra's script runs as one user from start to finish, so there is no hop,
  and the 10 MB limit keeps the heredoc to the files it suits (see [Steps](./steps.md#file)).

## SSH and ControlMaster

tsinfra runs the system `ssh` binary. That means `~/.ssh/config`, `ProxyJump`, `known_hosts`, and the SSH agent
(including 1Password's) all work with no tsinfra configuration.

Every `ssh` call passes:

```sh
ssh -T -o ControlMaster=auto -o ControlPath=~/.ssh/tsinfra-%C -o ControlPersist=60 -o BatchMode=yes -- <target> sh -s
```

- **`-T`** never gives the session a terminal, even when `~/.ssh/config` sets `RequestTTY`. A terminal would merge
  stderr into stdout and echo the script on stdin back as output.
- **ControlMaster** makes the first `ssh` to a host open a connection and leave a socket on the control machine. Every
  later `ssh` to that host goes through the socket and skips the TCP connect, key exchange, and authentication, so a
  command starts in milliseconds.
- **ControlPath** uses `%C`, a hash of the connection details, which keeps the socket path short. Unix socket paths
  are limited to 104 bytes on macOS, and ssh adds 17 characters to the path for a temporary name while it sets the
  socket up. That leaves room for a home directory of about 33 characters, and a longer one fails with ssh's
  `too long for Unix domain socket`. The `tsinfra-` prefix keeps these sockets apart from any the user configures.
- **ControlPersist** keeps the connection open for 60 seconds after the last command. That is a safety net, because the
  CLI closes each connection at the end of the run with `ssh -O stop`. `stop` lets sessions already on the connection
  finish, where `exit` would kill them. Two tsinfra runs to the same host share one socket, so one run's `exit` would
  kill the other's commands.
- **BatchMode** makes ssh fail instead of prompting. Hosts run in parallel, and a password or host-key prompt from one
  of them would hang the run. The error says to run `ssh <host>` once by hand.
- **`--`** ends ssh's options, so a target can't be read as one.

The first command to a host, the home read when it's prepared, opens the connection. An unreachable host fails
there, before its script runs, with ssh's error.

**Exit 255 is ssh's own failure.** A 255 fails the host with ssh's stderr, because a lost connection must never read as
a check that came back false. A command that itself exits 255, like a nested `ssh` that failed, reads as a lost
connection too. Ansible has the same limit. One 255 gets a single retry: `mux_client_hello_exchange: write packet:
Broken pipe` means the connection closed at its 60 idle seconds just as the command tried to join it. The command never
started, so running it again is safe. The retry waits 100 ms first, because the closing connection removes its socket
as it exits, and a retry before that would join it again. A host that sits idle while earlier hosts run can hit it. Ansible retries this
case too.

**Host keys and timeouts follow `~/.ssh/config`, with defaults where it says nothing.** A command-line `-o` always beats
the config file, so tsinfra reads the host's effective settings first, with `ssh -G <host>`. That runs locally, with no
network, once per host in preflight. Then it fills in only what ssh would otherwise leave unworkable:

| `StrictHostKeyChecking` | tsinfra passes | Why                                                                     |
| ----------------------- | -------------- | ----------------------------------------------------------------------- |
| `ask`, the default      | `accept-new`   | `ask` can't prompt under `BatchMode`, so every new host would fail      |
| `yes`                   | nothing        | The user chose strict. An unknown host fails, with a hint to `ssh` once |
| `accept-new` or `no`    | nothing        | Neither prompts                                                         |

- **What the settings mean.** For an unknown host, `yes` refuses, `ask` prompts and saves the key if you accept, and
  `accept-new` and `no` save it silently. For a changed key, all but `no` refuse. `-G` can't tell an explicit `ask`
  from the default, so an explicit `ask` gets upgraded too. It couldn't prompt anyway, and `yes` is the setting that
  keeps tsinfra strict.
- **A changed key always fails,** because `accept-new` refuses one too, and a changed key can mean the host isn't the
  one it was. tsinfra adds `if the host was recreated, remove its old key with ssh-keygen -R <host>`, and offers no way
  around it. A homelab container recreated under the same name hits this, unless cloud-init gives it a stable key.
- **`ConnectTimeout=10`** is passed when `-G` shows `connecttimeout none`, ssh's default, which leaves it to the OS and
  can take about 75 seconds. A timeout the user set is kept.
- **Connect retries are left to ssh.** `ConnectionAttempts` defaults to 1, and `-G` can't tell that from an explicit 1.
- **`LogLevel=ERROR`** is passed when `-G` shows `loglevel INFO`, ssh's default. At `INFO`, ssh prints a server's login
  banner and `accept-new`'s `Permanently added ... to the list of known hosts` on stderr, mixed into a command's own. A
  level the user set is kept.

### How other tools reach hosts

Researched from the source of each tool in November 2026:

| Tool                        | Reaches the host with                                | Reuses connections                               | Closes them                      |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| Ansible                     | the `ssh` binary, command as an argument or on stdin | `ControlPersist=60s`, in `~/.ansible/cp`         | never, except `reset_connection` |
| Mitogen                     | one `ssh` process per host for the whole run         | the one process                                  | at the end                       |
| Salt SSH                    | the `ssh` and `scp` binaries, under a terminal       | no                                               | no                               |
| nixos-rebuild               | the `ssh` binary, `--` before the command            | `ControlPersist=60`, in a temp directory per run | `-O exit` at exit                |
| colmena, Docker, git, rsync | the `ssh` binary                                     | no                                               | no                               |
| pyinfra, Fabric             | Paramiko, a Python library                           | no                                               | no                               |
| Chef, Kamal, Bolt           | net-ssh, a Ruby library (Bolt can run `ssh` instead) | no                                               | no                               |

What tsinfra takes from them, and where it differs:

- **The system `ssh` binary** is what Ansible, Salt SSH, nixos-rebuild, and colmena run, and what Ansible now runs
  only. The library tools keep catching up with ssh: pyinfra's issues cover the 1Password agent, `ProxyJump` edge
  cases, host certificates, and FIDO keys. Fabric and Train, Chef's library, skip host key checks by default. Bolt added
  a mode that runs `ssh`, because net-ssh lacked algorithms.
- **Defaults only where the config says nothing** is stricter than the others. Ansible always passes
  `ConnectTimeout`, colmena always passes `accept-new`, and pyinfra's `accept-new` default overrides the config's.
- **`-T`** comes from colmena and Docker. **`--`** comes from nixos-rebuild and Docker.
- **The retry on a closing connection** comes from Ansible. So does the limit on a command's own 255.
- **`-O stop` at the end** is between the two tools that close. nixos-rebuild runs `-O exit` on sockets that are its
  own, in a temp directory per run. A temp directory under macOS's `$TMPDIR` is too long for a socket path, so
  tsinfra shares `~/.ssh` between runs and stops instead.
- **The script on stdin** is Ansible's pipelining, which Ansible leaves off by default because sudo's `requiretty`
  needs a terminal. tsinfra's sudo gets its password through askpass, so it needs no terminal. A host with
  `requiretty` refuses sudo, and that setting has been off by default on RHEL since 7.

## Link writes

`link` writes with one script too, and it has its own problem. A plain `mv` onto a link to a directory moves the new link
into that directory, so the script has to tell `mv` not to follow it:

```sh
set -eu
mkdir -p '/home/adam/.config/fish'
tmp=$(mktemp -d '/home/adam/.config/fish/.config.fish.tsinfra.XXXXXX')
trap 'rm -rf "$tmp"' EXIT
tmppath="$tmp"/'config.fish'
touch "$tmp/probe"
if mv -T "$tmp/probe" "$tmp/probed" 2>/dev/null; then flag=-T; else flag=-h; fi
rm -f "$tmp/probe" "$tmp/probed"
ln -s '/home/adam/dotfiles/fish/config.fish' "$tmppath"
chown -h -- '501:20' "$tmppath"                     # when there's a value
rmdir '/home/adam/.config/fish/config.fish'         # only for a forced empty directory
mv -f "$flag" "$tmppath" '/home/adam/.config/fish/config.fish'   # with a fallback when replacing a link, see below
rm -rf "$tmp"
trap - EXIT
```

- **A temp directory, not a temp name.** `mktemp` can't create a symlink, and a fixed name could be a symlink someone
  planted. A new private directory has neither problem, and it's on the same filesystem, so the rename is atomic.
- **The flag gets tried on a file of its own.** GNU and busybox use `mv -T`, and BSD and macOS use `mv -h`. Trying them
  in turn on the real link would hide a real failure behind `invalid option`. The probe runs before the link exists,
  so a link named `probe` can't be mistaken for it.
- **The temp link is named like the destination,** the same as `file`'s temp file, so both writes share their temp
  directory lines.
- **`rmdir` runs first for an empty directory,** because a rename can't replace a directory with a link. That leaves a
  brief moment with nothing at the path. A file that appears in the directory makes `rmdir` fail, so nothing is lost.
- **Replacing a link falls back to removing it.** busybox's `mv -T` refuses to replace a link to a directory, unless the
  new link also points to a directory, and busybox has nothing else that renames a link. So when `mv` fails on an
  existing link, the script runs `rm -f` and tries again. That leaves the same brief moment, on busybox, in this case
  only. GNU and BSD rename it directly.

Of the tools in the table above, only Ansible replaces a link atomically by default, and Salt does with `atomic: true`.
Both call `rename()` directly, which never follows a link. pyinfra, Chef, Puppet, and cdist remove the old link first.

## sudo

Commands say `sudo` themselves, exactly where they need it, like `fix: "sudo systemctl enable --now sonarr"` or
`curl -fsSL ... | sudo tar -x -C /opt`. Only that command escalates, and the rest of a pipeline runs as the SSH user.
No command step or tool takes a `sudo` option. `file` and `link` do, because tsinfra writes their commands, so there's
nowhere else to put it (see [Steps](./steps.md#sudo-and-permissions)).

A host whose script uses sudo declares `sudo` on `host()`, whether that's a command's own `sudo` or `sudo: true` on
`file` or `link`. It's off by default:

```ts
export default host("macbook", fn, { sudo: true }) // prompts when passwordless sudo isn't set up
export default host("incus.lan", fn, { sudo: { password: incusSudo } }) // a password the script decrypted, never prompts
```

- **Declare `sudo: true` even with passwordless sudo.** There it only adds a check in preflight, with no prompt and no
  password. A broken sudo then fails in preflight, before any host changes anything. Without it, the host fails at the
  first `sudo` that needs a password, after the steps before it have run.
- **Give `{ password }` only when the run can't prompt,** like in CI or a cron job. A password already implies sudo, so
  one option has both forms.

The Incus containers have passwordless sudo through cloud-init, so `sudo: true` only checks it there. The Mac and the
first run on the Incus host need a password.

**Preflight.** Every host is prepared before any script runs: connect, read `$HOME`, and for a host that declares
`sudo`, check it. That happens for every host at once. Then the hosts that need a password prompt, one at a time, in the
hosts' order. Then the scripts run, one after another or in parallel, so a prompt never mixes with a running host's
output. A host that can't be reached fails here, before any other host changes anything. A host has to declare `sudo`
because of this: by the time its script runs, it's too late to ask.

- **The check** runs with no `sudo` function in front of it, and ignores cached credentials with `-k`. With
  `sudo: true`, it runs `sudo -n -k true`, so it works only when sudo needs no password. A password is checked by
  giving it to sudo on stdin, with `-p ''` so sudo prints no prompt:

  ```sh
  printf '%s\n' '...' | sudo -k -S -p '' true
  ```

  With `-S`, sudo makes one try and stops at the end of stdin, so a wrong password logs one failed try. Through the
  askpass helper, sudo would ask three times and log three, which can lock an account that `pam_faillock` guards.
  `printf` is a shell builtin, so the password still never goes into a command line. It works when sudo accepts the
  password or needs none. A wrong password ends sudo's output with a line like `sudo: 1 incorrect password attempt`,
  so the host fails with just `incorrect sudo password`, and sudo's lines add nothing. Any other failure, like a user
  who isn't in sudoers, fails with `failed to check the sudo password` and sudo's output under it, because then the
  password may well be right. The match is on English text, so another locale gets the second form.

- **`sudo: true` without passwordless sudo needs a password,** so preflight prompts for it, naming the SSH user from
  `id -un`:

  ```
  Ctrl-D to skip this host · Ctrl-C to cancel the entire run
  To run host 'macbook', enter the sudo password for user 'adam'.
  Password:
  ```

  The first line is dim, like the plan reminder, and the host and user are in the value color. Each password is
  checked the same way. A wrong one prints `Sorry, try again.` and asks again with only `Password:`, like sudo's own
  prompt, up to three tries like sudo itself. Then a warning says `incorrect sudo password, skipping host`, in the
  words of the error the host fails with, and a blank line comes before the next host's prompt, as it does after a
  right password. Any other failure stops at once, because typing again won't help, with the warning
  `failed to check the sudo password, skipping host`. Ctrl-D, anywhere in the line, warns `skipping host` the same
  way, and fails the host with `skipped sudo password prompt`. Ctrl-C ends the run. A wrong password from `host()`
  fails without a prompt, after the wait sudo adds to a failed try where it's set up to (about 2 seconds on Debian,
  none on Alpine).

- **The prompt goes to stderr,** because stdout is the report. sudo itself prompts on `/dev/tty`, which still works
  when stdout and stderr are redirected, but Bun can't read from it. The input is read from stdin with `node:readline`,
  whose output is muted so nothing typed is echoed. The prompt prints only once readline has the terminal in raw mode,
  because the terminal echoes anything typed before that.
- **No terminal, no prompt.** When stdin or stderr isn't a TTY, like in CI or with `2>file`, a host that needs a prompt
  fails in preflight with `needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()`.
  stderr counts too, because a redirected prompt would leave the run waiting on a prompt nobody sees.

**How a command's `sudo` gets the password.** On a host with a password, preflight writes an askpass helper to
`~/.tsinfra/askpass.sh`, and every script tsinfra sends starts with a preamble that defines `sudo` as a shell function:

```sh
sudo() { TSINFRA_SUDO_PASSWORD='...' SUDO_ASKPASS="$HOME"/.tsinfra/askpass.sh command sudo -A "$@"; }
```

- **The helper stays between runs.** It only prints `$TSINFRA_SUDO_PASSWORD`, so it holds no secret. Preflight writes
  it again on every run, so a deleted or changed helper comes back as it should be. It's written under a temp name and
  renamed into place, because another host on the same machine can be running it at that moment.
- **It lives in the home directory, not `/tmp`,** because sudo can't run a helper from a `/tmp` mounted `noexec`, which
  hardened hosts often do.
- **A host with a password always gets the askpass function,** even where sudo needs no password, because sudo only
  runs the helper when it wants a password. That also covers sudoers that let only some commands skip the password.

With `-A`, sudo runs the `SUDO_ASKPASS` program when it needs a password and reads the password from what it prints.
It was made for graphical password dialogs, and here the helper prints the password tsinfra holds. sudo only calls it
when it wants a password, so on a passwordless host, or with cached credentials, the helper never runs. sudo's own
cached credentials can't stand in for this, because they belong to one terminal session, and every tsinfra command is a
new session with no terminal.

- **The password never goes into a command line, a file, or the record.** The helper reads it from a variable the
  function sets for that one `sudo` call, and the script that sets it travels on stdin. sudo runs the helper with the
  caller's environment, which the Docker tests check on Alpine and Debian. Root and the same user can still see it while
  the command runs, the same as Ansible's become password.
- **The record shows the command as written,** like `sudo systemctl restart caddy`.
- **tsinfra's own commands escalate the same way,** through the same function, so the command that starts the shell is
  always plain `sh -s`. With `sudo: true`, the step's script runs in a nested `sudo sh -s`, sent in a heredoc with a
  random delimiter, because a path in the script can hold any line. The record holds the step's script as tsinfra wrote
  it, without the nesting.
- **A `sudo` inside a child process,** like a script file the command runs, or `xargs sudo`, doesn't see the function.
  Exporting `SUDO_ASKPASS` doesn't cover it, because sudo only runs the helper with `-A`, so those need passwordless
  sudo.

**A host without a password,** one that leaves `sudo` out or sets `sudo: true` on passwordless sudo, gets a preamble
that defines `sudo` as `sudo -n`. On a passwordless host that's all it needs. Where a password is needed, a plain
`sudo` over SSH fails anyway, with no terminal to prompt on, but locally it could open the real terminal and prompt in
the middle of the report. With `-n` it fails straight away with sudo's `a password is required`. When a host that
leaves `sudo` off fails in a step whose own command printed that line, the report adds a hint under that step's
failure, in italic yellow: `sudo needs a password on this host, so set the sudo option on host()`. The session works
it out when the step fails, from the step's own commands and the host's `sudo` option, and records it on the step. It's
a hint, not part of the error, so the error keeps sudo's own words. The match is on English text, so another locale
gets no hint.

On `file`, `sudo: true` covers the whole operation: the file details script, the diff, and the write. A root-only file under
`/etc` could not be hashed or read otherwise, so `plan` needs sudo too, which preflight provides. Content travels on
stdin, inside the script, so it never shows up in `ps` or in the sudo log, unless sudoers sets `log_input`, which
records stdin.
