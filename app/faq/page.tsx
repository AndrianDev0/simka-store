import { InfoPage } from "@/app/components/info-page";
import { jsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "FAQ о SIM и eSIM",
  description: "Ответы на частые вопросы о совместимости eSIM, начале срока тарифа, раздаче интернета и помощи с заказом.",
  path: "/faq",
});

const questions = [
  { question: "Поддерживает ли телефон eSIM?", answer: "В настройках найдите «Добавить eSIM» или проверьте модель на сайте производителя. Перед поездкой убедитесь, что устройство не заблокировано оператором." },
  { question: "Когда начинается срок тарифа?", answer: "Это зависит от оператора. Точное условие активации указано в карточке конкретного тарифа." },
  { question: "Можно ли раздавать интернет?", answer: "Возможность раздачи зависит от тарифа и оператора. Проверьте условия в карточке товара или уточните их у менеджера до оплаты." },
  { question: "Как получить помощь?", answer: "Откройте раздел «Контакты» и укажите номер заказа и email, который использовали при оформлении." },
];

export default function FAQPage() {
  const schema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) };
  return <><InfoPage eyebrow="FAQ" title="Ответы на частые вопросы" description="Коротко о выборе, активации и использовании SIMKA." cards={questions.map((item, index) => ({ title: item.question, body: <p>{item.answer}{index === questions.length - 1 && <> <a className="font-semibold text-[#1168e8] underline" href="/contacts">Перейти к контактам</a>.</>}</p> }))} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} /></>;
}
