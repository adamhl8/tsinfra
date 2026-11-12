#!/bin/sh
# Runs inside a container as root, with the repo at /repo: it sets up users and sudo, then runs the tests.
set -eu

distro="$1"

case "$distro" in
  alpine)
    apk add --no-cache sudo openssh >/dev/null
    for user in tester sonarr nopass sudopw; do adduser -D "$user"; done
    ;;
  debian)
    apt-get update -qq >/dev/null
    apt-get install -y -qq sudo openssh-client openssh-server >/dev/null 2>&1
    for user in tester sonarr nopass sudopw; do useradd -m "$user"; done
    ;;
  *)
    echo "unknown distro '$distro'" >&2
    exit 1
    ;;
esac

echo 'tester ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/tester
chmod 440 /etc/sudoers.d/tester

# Give `sudopw` a password with a quote in it, which `sudo-password.docker.ts` uses.
# Set `timestamp_timeout=0`, so a password one test gives can't carry over to the next.
echo "sudopw:it's tsinfra" | chpasswd >/dev/null 2>&1
printf '%s\n' 'Defaults:sudopw timestamp_timeout=0' 'sudopw ALL=(ALL) ALL' >/etc/sudoers.d/sudopw
chmod 440 /etc/sudoers.d/sudopw

# Gives the user `$1` an sshd of its own on port `$2`, which the tests start and stop, and a key that reaches it.
# The sshd runs as that user, so it logs in only that user.
# Replace the `!` that marks a new account locked, because sshd refuses a locked account even with a key.
# Leave the sshd's key out of `known_hosts`, so the first connection takes it with `accept-new`.
# Start the user's ssh config with the rest of the arguments, because ssh takes the first value it finds for an option.
# End it by pointing every `tsinfra-*` target at the sshd, which gives `tsinfra-sshd` the same name for each user.
setup_sshd() {
  user="$1"
  port="$2"
  shift 2
  home="/home/$user"
  sed -i "s/^$user:![^:]*:/$user:*:/" /etc/shadow
  mkdir -p "$home/sshd" "$home/.ssh"
  ssh-keygen -q -t ed25519 -N '' -f "$home/sshd/host_ed25519"
  ssh-keygen -q -t ed25519 -N '' -f "$home/.ssh/id_ed25519"
  cp "$home/.ssh/id_ed25519.pub" "$home/.ssh/authorized_keys"
  printf '%s\n' "ListenAddress 127.0.0.1:$port" "HostKey $home/sshd/host_ed25519" "PidFile $home/sshd/sshd.pid" \
    'AuthorizedKeysFile .ssh/authorized_keys' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' \
    >"$home/sshd/sshd_config"
  printf '%s\n' "$@" 'Host tsinfra-*' '  HostName 127.0.0.1' "  Port $port" >"$home/.ssh/config"
  chown -R "$user" "$home/.ssh" "$home/sshd"
  chmod 700 "$home/.ssh"
}

# Give `tester` the targets `ssh.docker.ts` needs.
# Save a different key for `tsinfra-changed`, so its real key reads as changed.
# Set `RequestTTY force`, so a test can check that tsinfra's `-T` wins over it.
# Give each host-key alias its own `HostKeyAlias`, so its `known_hosts` entry is its own.
mkdir -p /home/tester/sshd /home/tester/.ssh
ssh-keygen -q -t ed25519 -N '' -f /home/tester/sshd/other_host_ed25519
printf 'tsinfra-changed %s\n' "$(cat /home/tester/sshd/other_host_ed25519.pub)" >/home/tester/.ssh/known_hosts
setup_sshd tester 2222 \
  'Host tsinfra-sshd' '  RequestTTY force' \
  'Host tsinfra-new' '  HostKeyAlias tsinfra-new' \
  'Host tsinfra-strict' '  HostKeyAlias tsinfra-strict' '  StrictHostKeyChecking yes' \
  'Host tsinfra-changed' '  HostKeyAlias tsinfra-changed' \
  'Host tsinfra-no-sshd' '  HostName 127.0.0.1' '  Port 2223'

# Give `sudopw` an sshd too, so `sudo-password.docker.ts` can give sudo the password over ssh.
setup_sshd sudopw 2224

# Copy the repo, because the tests write to it, and install again, because node_modules holds the host's binaries.
mkdir /work
tar -C /repo --exclude=./.git --exclude=./dist --exclude=./node_modules --exclude=./.terraform -cf - . | tar -C /work -xf -
cd /work
bun install --frozen-lockfile --ignore-scripts >/dev/null
chown -R tester /work
chmod -R a+rX /work

failed=0

# Prints a heading and runs `bun test` with its args as `user`, recording a failure and carrying on.
run_tests() {
  heading="$1"
  user="$2"
  shift 2
  echo "--- $heading"
  # Set `USER`, because `os.userInfo` in Bun reads the name from it.
  su "$user" -s /bin/sh -c "cd /work && USER=$user PATH=$PATH bun test $*" || failed=1
}

run_tests "the test suite as a non-root user" tester
run_tests "the test suite as root" root
run_tests "real sudo and real root" tester ./src/transport/__tests__/step.docker.ts ./src/session/handlers/__tests__/file-sudo.docker.ts ./src/session/handlers/__tests__/link-sudo.docker.ts ./src/hosts/prepare/host-details/__tests__/sudo-passwordless.docker.ts
run_tests "a user whose sudo needs a password" sudopw ./src/hosts/prepare/host-details/__tests__/sudo-password.docker.ts ./src/hosts/prepare/host-details/__tests__/sudo-prompt.docker.ts
run_tests "a user with no sudo rule" nopass ./src/session/handlers/__tests__/file-no-sudo.docker.ts
run_tests "ssh to a real sshd" tester ./src/transport/__tests__/ssh.docker.ts ./src/session/handlers/__tests__/file-ssh.docker.ts

exit "$failed"
