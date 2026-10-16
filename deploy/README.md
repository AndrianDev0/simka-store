# SIMKA on simki.cc

## Server layout

- Application source: `/srv/simka/releases/20261016`.
- Private configuration: `/srv/simka/secrets/app.env` and `database.env` (root only).
- Build logs and previous nginx configurations: `/srv/simka/shared`.
- Compose project: `simka`; database volume: `simka_database`.
- PostgreSQL has no published port. The application listens only on `127.0.0.1:3100` on the host.
- Domain-specific nginx configuration: `/etc/nginx/sites-available/simka`.
- TLS certificate: `/etc/letsencrypt/live/simki.cc`; renewal managed by `certbot.timer`.

Keep the other project in its own directory, Compose project, network, database volume, and localhost port. Do not overwrite the global nginx configuration or use `docker system prune --volumes`.

## Updating

Build a uniquely tagged image from `deploy/Dockerfile`, run tests, then tag the successful image as `simka-app:latest` and run:

```sh
docker compose --ansi never -f deploy/compose.yml up -d --no-build app
curl --fail https://simki.cc/api/health
```

Do not run `down -v`: it deletes the database volume. Keep the previous application image for rollback. Database schema changes require separate review before rolling application versions back.

## Initial state

The owner requested a fresh database, with no demo products and no import from Render. Telegram webhook points to `https://simki.cc/api/telegram/webhook`. Never log webhook secrets or provider API keys.

The paid VPS backup option is disabled. Free encrypted database backups run on the server; see BACKUPS.md. Analytics hourly/daily/weekly timers also run on the server, using the application's existing secret without exposing it to GitHub.

## Email

Resend is configured with the verified simki.cc domain. A delivery test succeeded. Keep `RESEND_API_KEY` and `EMAIL_FROM` in the private server environment. Replies to noreply are not supported; customer emails direct questions to the site's Contacts page.
