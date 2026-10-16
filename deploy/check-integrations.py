import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path

settings = dict(line.split('=', 1) for line in Path('/srv/simka/secrets/app.env').read_text().splitlines() if '=' in line)
def request(url, data=None):
    try:
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except Exception as error:
        print('Integration request failed:', type(error).__name__, 'status:', getattr(error, 'code', None))
        if hasattr(error, 'read'):
            try:
                payload = json.loads(error.read())
                print('Provider error:', str(payload.get('data', {}).get('message', ''))[:300])
            except Exception:
                pass
        return {}

base = 'https://api.telegram.org/bot' + settings['TELEGRAM_BOT_TOKEN']
bot = request(base + '/getMe')
print('Telegram:', bool(bot.get('ok')), 'username:', bot.get('result', {}).get('username'))
if '--webhook' in sys.argv and bot.get('ok'):
    result = request(base + '/setWebhook', {
        'url': 'https://simki.cc/api/telegram/webhook',
        'secret_token': settings['TELEGRAM_WEBHOOK_SECRET'],
        'allowed_updates': ['message', 'callback_query'],
        'drop_pending_updates': False,
    })
    print('Webhook configured:', bool(result.get('ok')))
webhook = request(base + '/getWebhookInfo').get('result', {})
print('Webhook URL:', webhook.get('url'), 'pending:', webhook.get('pending_update_count'), 'last error:', webhook.get('last_error_message'))
plisio = request('https://api.plisio.net/api/v1/currencies/USD?' + urllib.parse.urlencode({'api_key': settings['PLISIO_SECRET_KEY']}))
print('Plisio status:', plisio.get('status'))
shop = request('https://api.plisio.net/api/v1/shops?' + urllib.parse.urlencode({'api_key': settings['PLISIO_SECRET_KEY']}))
print('Plisio shop authentication:', shop.get('status'))
