import { InfoPage } from "@/app/components/info-page";
export const metadata = { title: "Cookie Policy — SIMKA" };
export default function CookiesPage() { return <InfoPage eyebrow="Документы" title="Cookie Policy" description="Используем только необходимые технологии для работы сайта и оформления заказа." cards={[{ title: "Необходимые cookie", body: <p>Они помогают сохранять корректную работу интерфейса, корзины и защищённых запросов.</p> }, { title: "Контроль", body: <p>Вы можете ограничить cookie в настройках браузера, но это может повлиять на работу отдельных функций.</p> }]} />; }
