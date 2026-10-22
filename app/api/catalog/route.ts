import { getCatalogProductsByIds, queryCatalogProducts } from "@/lib/catalog-repository";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "no-store" };
  try {
    if (params.has("ids")) {
      const raw = params.get("ids") || "";
      if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(raw) || raw.length > 1600) return Response.json({ error: "Некорректные товары" }, { status: 400, headers });
      const ids = raw.split(",").map(Number);
      if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id))) return Response.json({ error: "Слишком много товаров" }, { status: 400, headers });
      return Response.json({ items: await getCatalogProductsByIds(ids, { requireDatabase: true }) }, { headers });
    }
    const type = params.get("type");
    return Response.json(await queryCatalogProducts({
      q: (params.get("q") || "").slice(0, 200),
      region: (params.get("region") || "").slice(0, 100),
      type: type === "eSIM" || type === "SIM" ? type : undefined,
    }, Number(params.get("page")) || 1, 24, { requireDatabase: true }), { headers });
  } catch {
    return Response.json({ error: "Не удалось загрузить тарифы. Попробуйте ещё раз." }, { status: 503, headers });
  }
}
