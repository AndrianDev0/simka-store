/* eslint-disable @next/next/no-img-element -- small local SVG flags do not need image optimization. */
const supportedFlags = new Set(["ae", "de", "es", "ge", "jp", "pl", "th", "tr", "us"]);

function flagCode(flag: string): string | null {
  const points = Array.from(flag).map((symbol) => symbol.codePointAt(0) ?? 0);
  if (points.length !== 2 || points.some((point) => point < 0x1f1e6 || point > 0x1f1ff)) return null;
  return String.fromCharCode(...points.map((point) => point - 0x1f1e6 + 65)).toLowerCase();
}

export function CountryFlag({ flag, country, className = "" }: { flag: string; country: string; className?: string }) {
  const code = flagCode(flag);
  return <span role="img" aria-label={`Флаг страны ${country}`} className={`inline-flex h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-card ${className}`}>
    {code && supportedFlags.has(code)
      ? <img src={`/flags/${code}.svg`} alt="" aria-hidden="true" width="64" height="48" className="h-full w-full object-cover" />
      : <span aria-hidden="true" className="text-xs font-semibold text-muted-foreground">{code?.toUpperCase() || country.slice(0, 2)}</span>}
  </span>;
}
