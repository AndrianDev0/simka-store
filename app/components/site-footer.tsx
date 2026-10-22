const groups = [
  { title: "Магазин", links: [["Каталог", "/catalog"], ["Страны", "/countries"], ["Категории", "/categories"], ["Личный кабинет", "/account"]] },
  { title: "Помощь", links: [["FAQ", "/faq"], ["Оплата", "/payment"], ["Доставка", "/delivery"], ["Контакты", "/contacts"], ["О компании", "/about"]] },
  { title: "Документы", links: [["Конфиденциальность", "/privacy"], ["Условия использования", "/terms"], ["Отмена и возврат", "/returns"], ["Cookie", "/cookies"]] },
];

export function SiteFooter() {
  return <footer className="border-t border-border bg-card text-card-foreground">
    <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
      <nav aria-label="Информация о магазине" className="grid gap-8 sm:grid-cols-3">
        {groups.map(({ title, links }) => <div key={title}><h2 className="text-sm font-semibold">{title}</h2><ul className="mt-3">{links.map(([label, href]) => <li key={href}><a href={href} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-primary">{label}</a></li>)}</ul></div>)}
      </nav>
      <p className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">© 2026 SIMKA. SIM и eSIM для путешествий.</p>
    </div>
  </footer>;
}
