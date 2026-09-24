import { redirect } from "next/navigation";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getCurrentAccount } from "@/lib/customer-auth";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "Управление персональными данными - SIMKA", description: "Экспорт и удаление персональных данных клиента SIMKA.", path: "/account/privacy", noindex: true });

export default async function AccountPrivacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await getCurrentAccount();
  if (!account) redirect("/account/login?returnTo=/account/privacy");
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  return <SiteShell eyebrow="Личный кабинет" title="Персональные данные" description="Скачайте копию своих данных или удалите аккаунт.">
    <ContentSection>
      <a href="/account" className="inline-flex min-h-11 items-center font-bold text-[#1168e8] hover:underline">← Вернуться в кабинет</a>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]">
          <h2 className="text-xl font-black text-[#10213a]">Скачать данные</h2>
          <p className="mt-3 text-sm leading-6 text-[#637389]">В JSON-файл войдут профиль, история входов, заказы, товары, статусы, доставка и сведения об оплате. Пароль, токены и зашифрованные коды активации не экспортируются.</p>
          <a href="/api/account/export" download className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Скачать копию данных</a>
        </section>
        <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]">
          <h2 className="text-xl font-black text-[#8b1f1f]">Удалить аккаунт</h2>
          <p className="mt-3 text-sm leading-6 text-[#637389]">Удаление необратимо. Аккаунт, сессии, контакты, адреса, комментарии, инструкции и трек-номера будут удалены. Финансовые записи завершённых заказов останутся только в обезличенном виде.</p>
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">Аккаунт нельзя удалить, пока есть незавершённые заказы. Сначала дождитесь выполнения или обратитесь в поддержку.</p>
          <details className="mt-5 rounded-xl border border-red-200 bg-red-50/40 p-4">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold text-[#8b1f1f]">Перейти к подтверждению</summary>
            <form action="/api/account/delete" method="post" className="mt-4 space-y-4">
              <label className="block text-sm font-semibold text-[#5f2424]">Текущий пароль<input name="password" type="password" required maxLength={200} autoComplete="current-password" className="mt-2 h-11 w-full rounded-xl border border-red-200 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-red-500"/></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-200 bg-white p-3 text-sm leading-6 text-[#5f2424]"><input name="confirm" value="yes" type="checkbox" required className="mt-1 size-5 shrink-0 accent-red-700"/><span>Я понимаю, что аккаунт и персональные данные нельзя будет восстановить.</span></label>
              <button className="min-h-11 w-full rounded-xl bg-red-700 px-4 font-bold text-white hover:bg-red-800">Безвозвратно удалить аккаунт</button>
            </form>
          </details>
        </section>
      </div>
    </ContentSection>
  </SiteShell>;
}
