const domainCorrections: Record<string, string> = {
  "hmail.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "yandex.ruu": "yandex.ru",
  "yndex.ru": "yandex.ru",
  "mail.ry": "mail.ru",
  "mai.ru": "mail.ru",
  "outlok.com": "outlook.com",
  "hotnail.com": "hotmail.com",
};

export function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase();
}

export function getEmailValidationError(value: string): string | null {
  const email = normalizeEmailAddress(value);
  if (!email) return "Введите email.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Введите корректный email, например name@gmail.com.";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const correction = domainCorrections[domain];
  return correction ? `Проверьте адрес: возможно, вы имели в виду ${email.slice(0, email.lastIndexOf("@") + 1)}${correction}.` : null;
}

export function isValidEmailAddress(value: string) {
  return getEmailValidationError(value) === null;
}
