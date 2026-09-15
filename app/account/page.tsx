import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { orders } from "@/db/schema";
import { getDb } from "@/db";
import { getCurrentAccount } from "@/lib/customer-auth";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "Личный кабинет — SIMKA", description: "Профиль и история заказов SIMKA.", path: "/account", noindex: true });

const statusLabels: Record<string, string> = {
  NEW: "Новый", WAITING_FOR_MANAGER: "Ожидает менеджера", WAITING_PAYMENT: "Ожидает оплаты", PAYMENT_PENDING: "Проверяем оплату",
  PAID: "Оплачен", PROCESSING: "Выполняется", SHIPPED: "Отправлен", DELIVERED: "Доставлен", COMPLETED: "Завершён",
  CANCELLED: "Отменён", REFUNDED: "Возврат", FAILED: "Ошибка",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await getCurrentAccount();
  if (!account) redirect("/account/login?returnTo=/account");
  const params = await searchParams;
  const db = getDb();
  const accountOrders = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency, createdAt: orders.createdAt, paymentMethod: orders.paymentMethod }).from(orders).where(eq(orders.customerAccountId, account.id)).orderBy(desc(orders.createdAt));
  return <SiteShell eyebrow="Личный кабинет" title={`Здравствуйте, ${account.name}`} description="Здесь собраны ваши заказы и контактные данные.">
    <ContentSection>
      {params.saved && <p className="mb-5 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">Данные профиля сохранены.</p>}
      {params.error && <p className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{String(params.error)}</p>}
      <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-[#10213a]">Профиль</h2><form action="/api/account/logout" method="post"><button className="text-sm font-bold text-[#1168e8] hover:underline">Выйти</button></form></div>
          <form action="/api/account/profile" method="post" className="mt-5 space-y-4">
            <label className="block text-sm font-semibold text-[#283b54]">Имя<input name="name" required minLength={2} maxLength={100} defaultValue={account.name} className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label>
            <label className="block text-sm font-semibold text-[#283b54]">Email<input value={account.email} readOnly className="mt-2 h-11 w-full rounded-xl border border-[#e1e8f0] bg-[#f7f9fb] px-3 font-normal text-[#637389]"/></label>
            <label className="block text-sm font-semibold text-[#283b54]">Telegram или телефон<span className="font-normal text-[#7a899a]"> — необязательно</span><input name="contact" maxLength={100} defaultValue={account.contact} className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="@username или +7…"/></label>
            <button className="min-h-11 w-full rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Сохранить профиль</button>
          </form>
          <div className="mt-5 border-t border-[#e5edf5] pt-5"><a href="/account/forgot" className="text-sm font-bold text-[#1168e8] hover:underline">Изменить пароль</a></div>
          <a href="/contacts" className="mt-5 block rounded-xl border border-[#cddbea] bg-[#f8fbfe] p-3 text-center text-sm font-bold text-[#1168e8] hover:border-[#9fc5f4] hover:bg-white">Обратиться в поддержку</a>
        </section>
        <section className="rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-[#10213a]">Мои заказы</h2><span className="text-sm text-[#637389]">{accountOrders.length}</span></div>
          {accountOrders.length ? <div className="mt-5 space-y-3">{accountOrders.map((order) => <a key={order.id} href={`/account/orders/${encodeURIComponent(order.orderNumber)}`} className="block rounded-xl border border-[#dbe5ef] bg-[#f8fbfe] p-4 transition hover:border-[#9fc5f4] hover:bg-white"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[#10213a]">{order.orderNumber}</strong><span className="rounded-full bg-[#eaf3ff] px-2.5 py-1 text-xs font-bold text-[#28577f]">{statusLabels[order.status] ?? order.status}</span></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-[#637389]"><span>{new Date(order.createdAt).toLocaleDateString("ru-RU")} · {order.paymentMethod === "manager" ? "Через менеджера" : "Криптовалюта"}</span><strong className="text-[#10213a]">{order.totalAmount.toLocaleString("ru-RU")} {order.currency}</strong></div></a>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-[#b8c9da] p-8 text-center"><p className="font-bold text-[#10213a]">Заказов пока нет</p><p className="mt-2 text-sm text-[#637389]">Выберите тариф в каталоге, чтобы оформить первый заказ.</p><a href="/catalog" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white">Открыть каталог</a></div>}
        </section>
      </div>
    </ContentSection>
  </SiteShell>;
}
