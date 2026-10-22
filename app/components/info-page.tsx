import { ContentSection, SiteShell } from "@/app/components/site-shell";

export function InfoPage({ eyebrow, title, description, cards }: { eyebrow: string; title: string; description: string; cards: Array<{ title: string; body: React.ReactNode }> }) {
  return <SiteShell eyebrow={eyebrow} title={title} description={description}><ContentSection><article className="mx-auto max-w-[760px] divide-y divide-border">{cards.map((card) => <section key={card.title} className="py-7 first:pt-0"><h2 className="text-xl font-bold text-foreground">{card.title}</h2><div className="mt-3 text-base leading-8 text-muted-foreground">{card.body}</div></section>)}</article></ContentSection></SiteShell>;
}
