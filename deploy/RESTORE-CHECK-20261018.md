# Database restore verification

Verified on 18 October 2026 (task date). Production database was not modified.

- Scheduled backup: `simka-20261018T031605143156981Z.dump.enc`.
- Fresh backup created via the installed systemd service: `simka-20261018T145808087502553Z.dump.enc`.
- Service result: success, exit 0. Daily timer active.
- Both encrypted archives decrypted using the server key and restored into separate new databases with `pg_restore --exit-on-error --no-owner --no-acl`; exit 0 for both.
- Both restored 29 public tables. Scheduled snapshot contained 13 product rows and 1 order; fresh snapshot contained 7 product image rows and 1 order.
- Fresh restore had zero unvalidated database constraints.
- All COPY row data was normalized by prefixing the table/column header to each row and sorting. SHA-256 matched each archive against its restored database:
  - Scheduled: `7cff44720e98d6ec4ab2871b24f376b36345c2ed72ab0c1e59343fa3643237c2`.
  - Fresh: `172a6c04eb3e7c25ee51aa95e08a8636c45b024adc8aedb3bea582dfbd556eec`.
- Full generated SQL hashes are not used as data equality proof because pg_dump and pg_restore render different auxiliary statements.

## Remaining recovery limitations

This verifies database recovery, not complete machine disaster recovery. The scheduled script does not archive `/srv/simka/uploads`, application secrets, or the release. Copies and the decryption key are on the same server, so an independent secured backup is still needed for server loss. No external backup destination or failure notification is configured. No payment, email, or delivery was triggered during verification.
