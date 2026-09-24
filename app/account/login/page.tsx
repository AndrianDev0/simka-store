/* eslint-disable @next/next/no-html-link-for-pages -- full page navigation keeps static hosting and Render routes reliable. */
import { pageMetadata } from "@/lib/seo";
import { safeAccountReturnPath } from "@/lib/account-return";

export const metadata = pageMetadata({ title: "Вход в личный кабинет - SIMKA", description: "Войдите, чтобы посмотреть историю заказов SIMKA.", path: "/account/login", noindex: true });

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const deleted = params.deleted === "1";
  const returnTo = safeAccountReturnPath(params.returnTo);
  const loginAction = `/api/account/login?returnTo=${encodeURIComponent(returnTo)}`;
  return <main className="min-h-screen bg-[#f7fbff] px-4 py-10 text-[#10213a]"><div className="mx-auto max-w-md"><a href="/" className="text-sm font-bold text-[#1168e8]">← На главную</a><section className="mt-8 rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]"><p className="text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">SIMKA</p><h1 className="mt-2 text-3xl font-black">Войти в кабинет</h1><p className="mt-2 text-sm text-[#637389]">История заказов и данные профиля в одном месте.</p>{deleted&&<p role="status" className="mt-5 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">Аккаунт и связанные персональные данные удалены.</p>}{error&&<p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}<form action={loginAction} method="post" className="mt-6 space-y-4"><label className="block text-sm font-semibold">Email<input name="email" type="email" required autoComplete="email" className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label><label className="block text-sm font-semibold">Пароль<input name="password" type="password" required autoComplete="current-password" className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label><button className="min-h-11 w-full rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Войти</button></form><div className="mt-5 flex flex-wrap justify-between gap-3 text-sm"><a href="/account/forgot" className="font-bold text-[#1168e8]">Забыли пароль?</a><a href="/account/register" className="font-bold text-[#1168e8]">Создать аккаунт</a></div></section></div></main>;
}
