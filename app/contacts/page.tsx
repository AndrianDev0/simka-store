import { InfoPage } from "@/app/components/info-page";
import { pageMetadata } from "@/lib/seo";
import { SUPPORT_TELEGRAM_URL, SUPPORT_TELEGRAM_USERNAME } from "@/lib/support";

export const metadata = pageMetadata({
  title: "Поддержка SIM и eSIM — контакты SIMKA",
  description: "Свяжитесь с поддержкой SIMKA в Telegram по вопросам тарифа, совместимости eSIM, оплаты, доставки, активации или статуса заказа.",
  path: "/contacts",
});

const supportLinkClassName = "mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1168e8] px-5 font-bold text-white transition hover:bg-[#0d56c3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2";

export default function ContactsPage() {
  return <InfoPage
    eyebrow="Поддержка"
    title="Поможем с SIM, eSIM и заказом"
    description="Напишите нам в Telegram. Чем точнее вы опишете вопрос, тем быстрее мы сможем разобраться."
    cards={[
      {
        title: "Связаться с поддержкой",
        body: <div>
          <p>Единственный указанный на сайте контакт поддержки — <strong className="text-[#10213a]">@{SUPPORT_TELEGRAM_USERNAME}</strong>. Сообщения обрабатываются по мере поступления.</p>
          <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer" className={supportLinkClassName} aria-label={`Открыть поддержку @${SUPPORT_TELEGRAM_USERNAME} в Telegram`}>
            Написать @{SUPPORT_TELEGRAM_USERNAME}
          </a>
        </div>,
      },
      {
        title: "Если вопрос по заказу",
        body: <div className="space-y-3">
          <p>Укажите номер заказа формата <strong className="text-[#10213a]">SIM-YYYYMMDD-XXXXXXXX</strong> и email, использованный при оформлении.</p>
          <p>Не публикуйте номер заказа и персональные данные в открытых чатах или комментариях.</p>
        </div>,
      },
      {
        title: "До оплаты",
        body: <p>Можно уточнить совместимость устройства, условия активации, покрытие, доступный объём интернета, срок тарифа, доставку физической SIM и итоговую сумму.</p>,
      },
      {
        title: "После оплаты",
        body: <p>Напишите, если не пришла eSIM, не открывается инструкция, код не устанавливается, требуется уточнить статус доставки или сообщить о проблеме с товаром.</p>,
      },
      {
        title: "Что подготовить",
        body: <p>Для технического вопроса сообщите модель устройства, страну использования, текст ошибки и выполненные шаги. Скриншот можно приложить, предварительно скрыв личные и платёжные данные.</p>,
      },
      {
        title: "Безопасность",
        body: <p>Поддержка не просит пароль от личного кабинета, код из SMS, данные банковской карты или секретную фразу кошелька. Не пересылайте QR-код eSIM посторонним.</p>,
      },
    ]}
  />;
}
