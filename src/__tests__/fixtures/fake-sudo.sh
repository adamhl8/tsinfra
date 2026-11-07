#!/bin/sh
# Logs the arguments next to this script, then runs the command as the same user.
# Sets `TSINFRA_FAKE_ROOT`, so the fake `id` reports root under it.
echo "$*" >>"$(dirname "$0")/sudo.log"
[ "$1" = -n ] && shift
TSINFRA_FAKE_ROOT=1 exec "$@"
