#!/bin/bash
set -Eeuo pipefail
umask 077
backup_dir=/srv/simka/backups
key_file=/srv/simka/secrets/backup.key
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || exit 0
test -s "$key_file"
test "$(stat -c %a "$key_file")" = 600
work_dir=$(mktemp -d "$backup_dir/.work.XXXXXXXX")
trap 'rm -f -- "$work_dir/database.dump" "$work_dir/database.enc"; rmdir -- "$work_dir"' EXIT
docker exec simka-db-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$work_dir/database.dump"
test -s "$work_dir/database.dump"
docker exec -i simka-db-1 pg_restore --list < "$work_dir/database.dump" > /dev/null
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -pass "file:$key_file" -in "$work_dir/database.dump" -out "$work_dir/database.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$key_file" -in "$work_dir/database.enc" | cmp - "$work_dir/database.dump"
backup_name="simka-$(date -u +%Y%m%dT%H%M%S%NZ).dump.enc"
mv -- "$work_dir/database.enc" "$backup_dir/$backup_name"
# Retention applies only after a new, verified dump has been saved.
find "$backup_dir" -maxdepth 1 -type f -name 'simka-*.dump.enc' -mtime +14 -delete
echo "Database backup verified: $backup_name"
