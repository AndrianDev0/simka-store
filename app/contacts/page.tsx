import { InfoPage } from "@/app/components/info-page";
import { pageMetadata } from "@/lib/seo";
import { SUPPORT_TELEGRAM_URL, SUPPORT_TELEGRAM_USERNAME } from "@/lib/support";

export const metadata = pageMetadata({ title: "Контакты и поддержка", description: "Свяжитесь с SIMKA по вопросам выбора тарифа, совместимости eSIM, оплаты, доставки или статуса заказа.", path: "/contacts" });
export default function ContactsPage() {
  return <InfoPage
    eyebrow="Контакты"
    title="Мы на связи"
    description="Поможем выбрать тариф и разобраться со статусом заказа."
    cards={[
      {
        title: "Поддержка в Telegram",
        body: <div>
          <p>Напишите нам в Telegram — ответим по выбору тарифа, оплате, доставке или активации.</p>
          <a
            href={SUPPORT_TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1168e8] px-5 font-bold text-white transition hover:bg-[#0d56c3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2"
            aria-label={`Открыть поддержку ${`@${SUPPORT_TELEGRAM_USERNAME}`} в Telegram`}
          >
            Написать @{SUPPORT_TELEGRAM_USERNAME}
          </a>
        </div>,
      },
      {
        title: "По заказу",
        body: <p>Для ускорения ответа сообщите номер заказа формата SIM-YYYYMMDD-XXXXXXXX и email, который использовали при оформлении.</p>,
      },
    ]}
  />;
}
