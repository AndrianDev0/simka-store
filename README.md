# SIMKA Store

Интернет-магазин физических SIM-карт и eSIM с каталогом по странам, операторам и категориям.

## Возможности

- карточки товаров, варианты тарифов и SEO-поля;
- корзина и серверная проверка заказа;
- оплата криптовалютой или через менеджера;
- доставка физических SIM с расчётом стоимости и трекингом;
- выдача eSIM по электронной почте;
- управление каталогом и заказами через Telegram-бота;
- страницы каталога, стран, категорий, FAQ и юридическая информация.

## Запуск

Требуется Node.js 22.13 или новее и PostgreSQL.

```bash
npm ci
npm run dev
```

Для production:

```bash
npm run build
npm run start:render
```

## Переменные окружения

Обязательные переменные:

- `DATABASE_URL` — строка подключения к PostgreSQL;
- `TELEGRAM_BOT_TOKEN` — токен административного бота;
- `TELEGRAM_ADMIN_IDS` — список ID администраторов через запятую;
- `TELEGRAM_WEBHOOK_SECRET` — секрет проверки webhook;
- `FULFILLMENT_ENCRYPTION_KEY` — отдельный ключ длиной не менее 32 символов для шифрования реквизитов и кодов eSIM.

Для отправки писем задаются `RESEND_API_KEY` и `EMAIL_FROM`.

Криптовалютная оплата включается только после подключения и проверки конкретного провайдера:

- `CRYPTO_PAYMENT_PROVIDER` — короткий идентификатор адаптера провайдера;
- `CRYPTO_PAYMENT_CREATE_URL` — HTTPS endpoint адаптера для создания платежа;
- `CRYPTO_PAYMENT_API_KEY` — серверный ключ адаптера;
- `CRYPTO_PAYMENT_WEBHOOK_SECRET` — отдельный секрет HMAC-SHA256 для webhook длиной не менее 32 символов;
- `NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED=true` — включает вариант оплаты в интерфейсе только после настройки остальных переменных.

Для формирования доверенных `return_url` и `webhook_url` также обязателен канонический HTTPS-адрес в `NEXT_PUBLIC_SITE_URL` без пути, например `https://example.com`.

Endpoint создания платежа получает JSON с `order_id`, `order_number`, `amount`, `currency`, `return_url`, `webhook_url` и должен вернуть `payment_id`, `status`, `checkout_url`. Webhook отправляется на указанный `webhook_url` с заголовками `X-Payment-Timestamp` и `X-Payment-Signature`; подпись — HMAC-SHA256 от строки `<timestamp>.<raw JSON body>`. Тело содержит `event_id`, `event_type`, `payment_id`, `order_id`, `status`, `amount`, `currency` и, для подтверждённой оплаты, `transaction_id`, `paid_at`. Возврат клиента по `return_url` никогда не меняет статус заказа.

Для аналитики задаются только нужные интеграции (значения встраиваются в клиентскую сборку):

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Measurement ID Google Analytics 4 (`G-...`);
- `GA_MEASUREMENT_API_SECRET` — секрет Measurement Protocol из GA4 → Администратор → Потоки данных → Measurement Protocol API secrets; нужен для отправки `purchase` в момент подтверждения оплаты;
- `NEXT_PUBLIC_YANDEX_METRIKA_ID` — числовой ID счётчика Яндекс.Метрики;
- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` — домен сайта в Plausible;
- `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` и `NEXT_PUBLIC_PLAUSIBLE_API_URL` — необязательные URL для self-hosted Plausible.

Аналитика включается только после согласия посетителя. Передаются обезличенные просмотры без query-параметров, агрегированные данные поиска и фильтров, действия с товарами и корзиной, начало оформления, способ оплаты, создание заказа (`generate_lead`), подтверждённая продажа (`purchase`), отмена/возврат, авторизация, ошибки и Web Vitals. При настроенном `GA_MEASUREMENT_API_SECRET` продажа отправляется сервером сразу после подтверждения оплаты менеджером; браузерная отправка остаётся резервной. Имя, email, телефон, адрес, поисковый текст, токены и платёжные данные в аналитику не отправляются.

## Структура

- `app/` — страницы, API и пользовательские сценарии;
- `db/` — схема и подключение к базе;
- `lib/` — бизнес-логика и интеграции;
- `public/` — статические ресурсы;
- `scripts/` — запуск и миграция базы данных.

Не коммитьте файлы `.env*`, ключи и токены.
