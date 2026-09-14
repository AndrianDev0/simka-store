import { ArrowRight, Wifi } from "lucide-react";
import Link from "next/link";

export function SiteShell({ children, eyebrow, title, description }: { children: React.ReactNode; eyebrow: string; title: string; description?: string }) {
  return <main className="min-h-screen bg-background text-foreground">
    <div className="border-b border-[#dce7f4] bg-[#edf7ff] px-4 py-2 text-center text-[13px] font-medium text-[#164475]">Мгновенная доставка eSIM на email · Поддержка 7 дней в неделю</div>
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="SIMKA — на главную"><span className="grid size-10 place-items-center rounded-[13px] bg-[#1168e8] text-white shadow-[0_7px_18px_rgba(17,104,232,.25)]"><Wifi className="size-5"/></span><span className="text-[21px] font-black tracking-[-0.04em] text-[#10213a]">SIMKA</span></Link>
        <nav className="hidden items-center gap-6 text-[14px] font-semibold text-[#42526a] lg:flex"><a href="/catalog" className="hover:text-[#1168e8]">Каталог</a><a href="/categories" className="hover:text-[#1168e8]">Категории</a><a href="/countries" className="hover:text-[#1168e8]">Страны</a><a href="/search" className="hover:text-[#1168e8]">Поиск</a><a href="/faq" className="hover:text-[#1168e8]">FAQ</a></nav>
        <Link href="/?checkout=1" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#10213a] px-4 text-sm font-bold text-white hover:bg-[#1168e8]">Открыть магазин <ArrowRight className="size-4"/></Link>
      </div>
    </header>
    <section className="border-b border-[#dce7f4] bg-[#f7fbff] px-4 py-14 sm:px-6 sm:py-20"><div className="mx-auto max-w-[1000px]"><p className="mb-3 text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">{eyebrow}</p><h1 className="max-w-[800px] text-4xl font-black tracking-[-.05em] text-[#10213a] sm:text-6xl">{title}</h1>{description&&<p className="mt-5 max-w-[700px] text-base leading-7 text-[#637389] sm:text-lg">{description}</p>}</div></section>
    {children}
    <footer className="border-t border-[#dce7f4] bg-white"><div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 py-8 text-sm text-[#637389] sm:flex-row sm:items-center sm:justify-between sm:px-6"><span>© 2026 SIMKA. SIM и eSIM для путешествий.</span><nav className="flex flex-wrap gap-x-5 gap-y-2"><a href="/payment" className="hover:text-[#1168e8]">Оплата</a><a href="/delivery" className="hover:text-[#1168e8]">Доставка</a><a href="/contacts" className="hover:text-[#1168e8]">Контакты</a><a href="/privacy" className="hover:text-[#1168e8]">Конфиденциальность</a><a href="/terms" className="hover:text-[#1168e8]">Условия</a><a href="/returns" className="hover:text-[#1168e8]">Возврат</a><a href="/cookies" className="hover:text-[#1168e8]">Cookie</a></nav></div></footer>
  </main>;
}

export function ContentSection({ children }: { children: React.ReactNode }) { return <section className="mx-auto max-w-[1000px] px-4 py-12 sm:px-6 sm:py-16">{children}</section>; }

export function InfoCard({ title, children }: { title: string; children: React.ReactNode }) { return <article className="rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.06)]"><h2 className="text-xl font-black text-[#10213a]">{title}</h2><div className="mt-3 text-sm leading-7 text-[#637389]">{children}</div></article>; }
