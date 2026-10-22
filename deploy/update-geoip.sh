#!/usr/bin/env bash
set -euo pipefail
base=/srv/simka/geoip
mkdir -p "$base"
exec 9>"$base/.update.lock"
flock -n 9 || exit 0
month=$(date -u +%Y-%m)
name="dbip-city-lite-$month.mmdb"
if [ -s "$base/$name" ] && [ "$(readlink "$base/dbip-city-lite.mmdb")" = "$name" ]; then
  echo "DB-IP $month already installed"
  exit 0
fi
stage=$(mktemp "$base/.download.XXXXXX.mmdb")
trap 'rm -f -- "$stage" "$stage.gz" "$stage.link"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 600 --retry 2 \
  "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz" -o "$stage.gz"
gzip -t "$stage.gz"
gzip -dc "$stage.gz" > "$stage"
chmod 644 "$stage"
docker exec simka-app-1 node --input-type=module -e '
  import fs from "node:fs";
  import { Reader } from "mmdb-lib";
  const file = process.argv[1];
  const reader = new Reader(fs.readFileSync(file));
  if (!reader.get("8.8.8.8")?.country?.iso_code) throw new Error("Invalid GeoIP database");
' "/var/lib/simka-geoip/$(basename "$stage")"
mv -- "$stage" "$base/$name"
ln -s "$name" "$stage.link"
mv -Tf -- "$stage.link" "$base/dbip-city-lite.mmdb"
echo "DB-IP $month installed; previous monthly files retained"
