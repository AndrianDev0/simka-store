"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { trackEvent("exception", { fatal: true, error_area: "page" }); }, []);
  return <main className="grid min-h-screen place-items-center bg-[#f7fbff] px-4 text-[#10213a]"><section className="w-full max-w-md rounded-2xl border border-[#dbe5ef] bg-white p-7 text-center shadow-[0_12px_35px_rgba(23,58,96,.08)]"><p className="text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">SIMKA</p><h1 className="mt-3 text-2xl font-black">Что-то пошло не так</h1><p className="mt-2 text-sm leading-6 text-[#637389]">Попробуйте повторить действие. Если ошибка останется, обратитесь в поддержку.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><button type="button" onClick={reset} className="min-h-11 rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Повторить</button><a href="/contacts" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#1168e8] hover:bg-[#f4f8fd]">Поддержка</a></div></section></main>;
}
