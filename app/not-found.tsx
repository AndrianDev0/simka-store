"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- these actions intentionally perform reliable full-page navigation. */

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { useAnalyticsReady } from "@/app/components/analytics-events";

export default function NotFoundPage() {
  const ready = useAnalyticsReady();
  useEffect(() => { if (ready) trackEvent("page_not_found", { page_path: window.location.pathname }); }, [ready]);
  return <main className="grid min-h-screen place-items-center bg-[#f7fbff] px-4 text-[#10213a]"><section className="w-full max-w-md rounded-2xl border border-[#dbe5ef] bg-white p-7 text-center shadow-[0_12px_35px_rgba(23,58,96,.08)]"><p className="text-sm font-black text-[#1168e8]">Ошибка 404</p><h1 className="mt-3 text-3xl font-black">Страница не найдена</h1><p className="mt-2 text-sm leading-6 text-[#637389]">Возможно, адрес изменился или страница была удалена.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><a href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">На главную</a><a href="/catalog" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#1168e8] hover:bg-[#f4f8fd]">В каталог</a></div></section></main>;
}
