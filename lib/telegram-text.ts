export function splitTelegramText(text: string, maximum = 3900): string[] {
  if (maximum < 2) throw new Error("MESSAGE_LIMIT_TOO_SMALL");
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maximum) {
    let boundary = remaining.lastIndexOf("\n", maximum);
    if (boundary < 1) boundary = maximum;
    if (/^[\uDC00-\uDFFF]$/.test(remaining[boundary])) boundary -= 1;
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary);
  }
  chunks.push(remaining);
  return chunks;
}
