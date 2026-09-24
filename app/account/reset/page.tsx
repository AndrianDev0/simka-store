import { findPasswordReset } from "@/lib/customer-auth";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "Новый пароль - SIMKA", description: "Задайте новый пароль для кабинета SIMKA.", path: "/account/reset", noindex: true });

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const valid = Boolean(token && await findPasswordReset(token));
  const error = typeof params.error === "string" ? params.error : "";
  return <main className="min-h-screen bg-[#f7fbff] px-4 py-10 text-[#10213a]"><div className="mx-auto max-w-md"><a href="/account/login" className="text-sm font-bold text-[#1168e8]">← Вернуться ко входу</a><section className="mt-8 rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]"><p className="text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">SIMKA</p><h1 className="mt-2 text-3xl font-black">Новый пароль</h1>{!valid?<p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">Ссылка недействительна или уже истекла. Запросите восстановление ещё раз.</p>:<form action="/api/account/reset" method="post" className="mt-6 space-y-4"><input type="hidden" name="token" value={token}/>{error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}<label className="block text-sm font-semibold">Новый пароль <span className="font-normal text-[#7a899a]">- минимум 12 символов</span><input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label><label className="block text-sm font-semibold">Повторите пароль<input name="passwordConfirmation" type="password" required minLength={12} maxLength={200} autoComplete="new-password" className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label><button className="min-h-11 w-full rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Сохранить новый пароль</button></form>}</section></div></main>;
}
