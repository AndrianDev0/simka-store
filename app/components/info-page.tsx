import { ContentSection, InfoCard, SiteShell } from "@/app/components/site-shell";

export function InfoPage({ eyebrow, title, description, cards }: { eyebrow: string; title: string; description: string; cards: Array<{ title: string; body: React.ReactNode }> }) {
  return <SiteShell eyebrow={eyebrow} title={title} description={description}><ContentSection><div className="grid gap-4 md:grid-cols-2">{cards.map((card) => <InfoCard key={card.title} title={card.title}>{card.body}</InfoCard>)}</div></ContentSection></SiteShell>;
}
