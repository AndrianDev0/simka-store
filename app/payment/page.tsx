import { InfoPage } from "@/app/components/info-page";
import { pageMetadata } from "@/lib/seo";
import { getCryptoPaymentConfig } from "@/lib/crypto-payments";
export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "Оплата заказа", description: "Как проходит оплата SIM и eSIM через менеджера: заказ, реквизиты на email, подтверждение оплаты и выдача товара.", path: "/payment" });
export default function PaymentPage() { return <InfoPage eyebrow="Оплата" title="Оплата заказа" description="Доступные способы оплаты указаны при оформлении." cards={[{ title: "Через менеджера", body: <p>После создания заказа менеджер получает уведомление и отправляет реквизиты на email, указанный при оформлении. Сохраните номер заказа до получения письма. После поступления денег менеджер подтверждает оплату и выдаёт eSIM или организует отправку SIM.</p> }, { title: "Криптовалюта", body: <p>{getCryptoPaymentConfig() ? "После оформления откройте страницу Plisio, выберите валюту и сеть и следуйте инструкции. Статус заказа обновится после подтверждения платежа провайдером." : "Криптооплата временно недоступна. Выберите другой способ при оформлении."}</p> }]} />; }
