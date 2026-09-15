import { InfoPage } from "@/app/components/info-page";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({ title: "Контакты и поддержка", description: "Свяжитесь с SIMKA по вопросам выбора тарифа, совместимости eSIM, оплаты, доставки или статуса заказа.", path: "/contacts" });
export default function ContactsPage() { return <InfoPage eyebrow="Контакты" title="Мы на связи" description="Поможем выбрать тариф и разобраться со статусом заказа." cards={[{ title: "Поддержка", body: <p>Укажите email, Telegram или телефон в заказе — менеджер ответит удобным способом.</p> }, { title: "По заказу", body: <p>Для ускорения ответа сообщите номер заказа формата SIM-YYYYMMDD-XXXXXXXX и email, который использовали при оформлении.</p> }]} />; }
