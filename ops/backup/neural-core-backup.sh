#!/usr/bin/env bash
# Encrypted PostgreSQL backup: local Unix-socket source -> AGE ciphertext.
# No plaintext dump files, no key material, no network, no automatic deletion.
set -Eeuo pipefail
umask 077

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }
mode="${1:-}"
[[ "$#" == 1 && ( "$mode" == '--check' || "$mode" == '--run' ) ]] ||
  fail "Usage: $0 --check | --run"

backup_dir='/var/backups/neural-core'
recipient_file='/etc/neural-core/backup-recipient.txt'
database='neuralcore'
cluster='16/main'

command -v age >/dev/null 2>&1 || fail "age CLI is missing (install only after reviewing service-restart prompts)"
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is missing"
command -v setpriv >/dev/null 2>&1 || fail "setpriv (util-linux) is missing"
[[ -d "$backup_dir" ]] || fail "$backup_dir does not exist"
[[ "$(stat -c '%U:%G %a' "$backup_dir")" == 'root:root 700' ]] ||
  fail "$backup_dir must be root:root mode 0700"
[[ -f "$recipient_file" && ! -L "$recipient_file" ]] ||
  fail "AGE recipient file missing or symlinked"
[[ "$(stat -c '%U' "$recipient_file")" == 'root' ]] ||
  fail "AGE recipient file must be owned by root"

# Exactly one public recipient, supplied from a key generated on a separate
# trusted device. NEVER store the private AGE identity on the VPS.
recipient="$(tr -d '\r\n' < "$recipient_file")"
[[ "$recipient" =~ ^age1[a-z0-9]{58}$ ]] ||
  fail "Recipient must contain one valid-looking AGE X25519 public recipient"
[[ "$(wc -l < "$recipient_file")" -le 1 ]] ||
  fail "Unexpected extra lines in recipient file"

# Refuse to run against an unisolated PostgreSQL instance.
if command -v systemctl >/dev/null 2>&1; then
  [[ "$(systemctl show postgresql@16-main.service -p Slice --value)" == 'neural-core.slice' ]] ||
    fail "postgresql@16-main.service is outside neural-core.slice"
  systemctl is-active --quiet postgresql@16-main.service ||
    fail "PostgreSQL is not active"
fi

if [[ "$mode" == '--check' ]]; then
  note "PASS: preflight checks satisfied; backup not created"
  exit 0
fi

[[ "$EUID" -eq 0 ]] || fail "--run requires root (systemd service)"
[[ ! -e '/etc/neural-core/backup-key.txt' ]] ||
  fail "Private AGE identity detected on the VPS; move it to a trusted device"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_dir/neuralcore-${stamp}-$$.dump.age"
partial="$(mktemp "$backup_dir/.partial.XXXXXXXX.age")"
trap 'rm -f -- "$partial"' EXIT

# Pipe the compressed PG custom dump directly into AGE encryption, never
# writing plaintext database contents to the VPS filesystem.
# The hardened systemd unit grants only CAP_SETUID/CAP_SETGID. runuser invokes
# PAM and fails here because PAM attempts additional privileged operations.
# setpriv changes identity directly, bypassing PAM and avoiding wider caps.
setpriv --reuid=postgres --regid=postgres --clear-groups -- pg_dump \
  --host=/var/run/postgresql --port=5432 \
  --username=postgres --dbname="$database" \
  --format=custom --compress=3 \
  | age -r "$recipient" > "$partial"

[[ -s "$partial" ]] || fail "Encrypted backup is empty"
chmod 0600 "$partial"
# Target is unique by timestamp+PID; fail if it somehow exists.
[[ ! -e "$final" ]] || fail "Refusing to overwrite an existing archive"
mv -- "$partial" "$final"
trap - EXIT

(
  cd "$backup_dir"
  sha256sum -- "$(basename "$final")" > "$(basename "$final").sha256"
)
chmod 0600 "$final.sha256"
note "PASS: encrypted backup and ciphertext checksum created"
note "Path: $final"
note "Bytes: $(stat -c '%s' "$final")"
note "NOTE: Backup is not certified until successful offline decryption and test-db restoration"
