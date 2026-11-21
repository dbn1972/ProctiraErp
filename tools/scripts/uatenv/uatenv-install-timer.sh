#!/usr/bin/env bash
# Install the nightly backup as a systemd *user* timer (no sudo; Linger=yes keeps
# the user manager running across reboots and logouts).
# Units come from infrastructure/uat-ec2/systemd/*.in in runtime/tooling.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
UNIT_DIR="$HOME/.config/systemd/user"
SRC="$UATENV_RT/tooling/infrastructure/uat-ec2/systemd"
mkdir -p "$UNIT_DIR"
for unit in proctira-uatenv-backup.service proctira-uatenv-backup.timer; do
  sed -e "s#@UATENV_HOME@#$UATENV_HOME#g" "$SRC/$unit.in" >"$UNIT_DIR/$unit"
  chmod 644 "$UNIT_DIR/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now proctira-uatenv-backup.timer
if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != yes ]]; then
  uatenv_log "WARNING: Linger is off; the timer only runs while $(id -un) is logged in (sudo loginctl enable-linger $(id -un))"
fi
systemctl --user list-timers proctira-uatenv-backup.timer --no-pager
