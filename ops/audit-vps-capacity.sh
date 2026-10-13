#!/usr/bin/env bash
# Neural Core VPS capacity audit. READ-ONLY. No files, services, or settings are changed.
set -euo pipefail
export LC_ALL=C

section() { printf '\n== %s ==\n' "$1"; }
exists() { command -v "$1" >/dev/null 2>&1; }

section "Host / UTC"
date -u '+UTC %Y-%m-%d %H:%M:%S'
printf 'Kernel: '; uname -srm
printf 'Logical CPUs: '; (getconf _NPROCESSORS_ONLN || true)
printf 'Load averages: '; cat /proc/loadavg | cut -d' ' -f1-3
uptime || true

section "RAM (MiB)"
free -m || true
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {printf "%-17s %8.0f MiB\n", $1, $2/1024}' /proc/meminfo

section "Top memory-using processes (no command-line arguments)"
ps -eo pid,user,comm,rss,%cpu --sort=-rss | head -n 16 || true

section "Paper/Java processes and allocated *resident* RAM"
ps -eo pid,user,comm,rss,%cpu | awk 'NR==1 || /[j]ava|[p]aper/ {print}' || true
echo 'NOTE: Java -Xmx is not the total process RSS. MemoryMax must cover full RSS, native memory and spikes.'

section "System pressure (10/60/300 second rolling averages)"
for f in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do
  if [[ -r "$f" ]]; then printf '%s\n' "$f"; cat "$f"; fi
done

section "Disk usage (mounted filesystems only)"
df -hT -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -h

section "Relevant running systemd services (names and state only)"
if exists systemctl; then
  systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null \
    | awk 'tolower($1) ~ /minecraft|paper|plexon|postgres|docker|podman|caddy|relay|backup/ { print $1, $3, $4 }' || true
else
  echo 'systemctl not available'
fi

section "Neural Core status"
if exists systemctl; then
  systemctl status neural-core.slice --no-pager --lines=0 2>&1 | sed -n '1,8p' || true
fi
printf '\nRead-only audit complete. No services were modified.\n'
