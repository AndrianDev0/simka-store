"""Initialize a new SIMKA installation. Never overwrite existing secrets."""
from pathlib import Path
import os
import secrets

os.umask(0o077)
folder = Path('/srv/simka/secrets')
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
if (folder / 'app.env').exists() or (folder / 'database.env').exists():
    raise SystemExit('Secrets already exist; refusing to overwrite')
password = secrets.token_hex(32)
integrations = (folder / 'integrations.env').read_text().strip()
(folder / 'database.env').write_text(f'POSTGRES_USER=simka\nPOSTGRES_DB=simka\nPOSTGRES_PASSWORD={password}\n')
settings = {
    'DATABASE_URL': f'postgresql://simka:{password}@db:5432/simka',
    'DATABASE_SSL': 'disable',
    'SEED_DEMO_DATA': 'false',
    'NEXT_PUBLIC_SITE_URL': 'https://simki.cc',
    'TELEGRAM_ADMIN_IDS': '7580175496',
    'TELEGRAM_WEBHOOK_SECRET': secrets.token_hex(32),
    'FULFILLMENT_ENCRYPTION_KEY': secrets.token_hex(32),
    'BACKUP_ENCRYPTION_KEY': secrets.token_hex(32),
    'BACKUP_CRON_SECRET': secrets.token_hex(32),
    'RATE_LIMIT_SECRET': secrets.token_hex(32),
    'PARTNER_ATTRIBUTION_SECRET': secrets.token_hex(32),
    'CRYPTO_PAYMENT_PROVIDER': 'plisio',
    'NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED': 'true',
}
(folder / 'app.env').write_text(''.join(f'{key}={value}\n' for key, value in settings.items()) + integrations + '\n')
print('SIMKA environment initialized. Secret values were not printed.')
