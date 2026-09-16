/* eslint-disable @next/next/no-img-element -- small local SVG flags do not need image optimization. */
const supportedFlags = new Set(["ae", "de", "jp", "th", "tr", "us"]);

function flagCode(flag: string): string | null {
  const points = Array.from(flag).map((symbol) => symbol.codePointAt(0) ?? 0);
  if (points.length !== 2 || points.some((point) => point < 0x1f1e6 || point > 0x1f1ff)) return null;
  return String.fromCharCode(...points.map((point) => point - 0x1f1e6 + 65)).toLowerCase();
}

export function CountryFlag({ flag, country, className = "" }: { flag: string; country: string; className?: string }) {
  const code = flagCode(flag);
  return <span role="img" aria-label={`Флаг страны ${country}`} className={`inline-flex h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white shadow-[0_2px_8px_rgba(0,0,0,.18)] ${className}`}>
    {code && supportedFlags.has(code)
      ? <img src={`/flags/${code}.svg`} alt="" aria-hidden="true" width="64" height="48" className="h-full w-full object-cover" />
      : <span aria-hidden="true" className="text-[22px] leading-none">{flag || "🌍"}</span>}
  </span>;
}
