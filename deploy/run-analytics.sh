#!/bin/bash
set -Eeuo pipefail
case "${1:-}" in hourly|daily|weekly) ;; *) exit 2 ;; esac
exec docker exec simka-app-1 node -e '
const task = process.argv[1];
const secret = process.env.BACKUP_CRON_SECRET;
if (!secret || secret.length < 32) process.exit(2);
fetch(`http://127.0.0.1:3000/api/operations/analytics?task=${task}`, {
  method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(600000)
}).then(async response => {
  console.log(await response.text());
  if (!response.ok) process.exitCode = 1;
}).catch(() => { console.error("analytics_request_failed"); process.exitCode = 1; });
' "$1"
