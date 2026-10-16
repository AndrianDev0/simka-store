# SIMKA database backups

Installed on the SIMKA VPS on 2026-10-17 (user local date).

- Timer: `simka-backup.timer`, daily 03:15 UTC with up to five minutes jitter. Missed runs execute after boot.
- Script: `/srv/simka/bin/backup-database.sh`.
- Storage: `/srv/simka/backups`, root-only, encrypted full PostgreSQL custom dumps.
- Encryption key: `/srv/simka/secrets/backup.key`, root-only. Never commit it.
- Retention: files older than 14 days removed only after a successful new backup.
- Each run validates the dump index and verifies decrypted bytes against the original dump.
- Logs: `journalctl -u simka-backup.service`. Failure is recorded by systemd; external failure notifications are not configured.

## Verification completed

The first encrypted backup was decrypted and restored with `pg_restore --exit-on-error` into an isolated database. All 29 public tables restored, including the one existing order. Normalized data-only dump SHA-256 hashes matched between the live and restored databases. The temporary verification database was then removed. The application database was not replaced or edited.

## Recovery

Create a NEW database in the PostgreSQL container, decrypt the selected file using OpenSSL AES-256-CBC, PBKDF2, 600000 iterations and the key file, and pipe into `pg_restore --no-owner --no-acl --exit-on-error`. Verify records before any application switchover. Never restore directly over production without a separately approved recovery plan.

These are database backups, not complete server snapshots. Recovery on another server also needs the application secrets (especially field-encryption keys), application release, and the backup encryption key. Keep an independent secured copy of those outside this server. Same-server backups do not protect against server/disk loss or root compromise. No paid backup option or external storage was enabled.
