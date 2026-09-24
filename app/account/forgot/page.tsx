import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Восстановление доступа - SIMKA", description: "Восстановите доступ к личному кабинету SIMKA.", path: "/account/forgot", noindex: true });

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const sent = Boolean(params.sent);
  return <main className="min-h-screen bg-[#f7fbff] px-4 py-10 text-[#10213a]"><div className="mx-auto max-w-md"><a href="/account/login" className="text-sm font-bold text-[#1168e8]">← Вернуться ко входу</a><section className="mt-8 rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]"><p className="text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">SIMKA</p><h1 className="mt-2 text-3xl font-black">Восстановить пароль</h1>{sent?<p className="mt-5 rounded-xl border border-green-200 bg-green-50 p-3 text-sm leading-6 text-green-800">Если аккаунт с таким email существует и почта настроена, письмо со ссылкой уже отправлено. Проверьте входящие и папку «Спам».</p>:<><p className="mt-2 text-sm leading-6 text-[#637389]">Укажите email, который использовали при регистрации.</p><form action="/api/account/forgot" method="post" className="mt-6 space-y-4"><label className="block text-sm font-semibold">Email<input name="email" type="email" required autoComplete="email" className="mt-2 h-11 w-full rounded-xl border border-[#cddbea] px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"/></label><button className="min-h-11 w-full rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Отправить ссылку</button></form></>}</section></div></main>;
}
