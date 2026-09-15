import { ImageResponse } from "next/og";
import { getCatalogProductBySlug } from "@/lib/catalog-repository";

export const alt = "Тариф SIMKA для путешествий";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function formatPrice(price: number, currency: string) {
  return `${new Intl.NumberFormat("ru-RU").format(price)} ${currency}`;
}

export default async function ProductOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getCatalogProductBySlug(slug);
  const title = product?.name || "SIM и eSIM для путешествий";
  const destination = product ? `${product.country} · ${product.operator}` : "Тарифы по странам";
  const details = product ? `${product.data} · ${product.days} дней · ${formatPrice(product.price, product.currency)}` : "Выбор тарифа и оформление онлайн";

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", position: "relative", background: "linear-gradient(135deg, #0c1e36 0%, #0f5fd5 58%, #39a2f0 100%)", color: "white", padding: "70px", fontFamily: "Arial, sans-serif" }}>
      <div style={{ position: "absolute", width: 380, height: 380, right: -80, top: -110, borderRadius: 999, background: "rgba(183,243,74,.22)", display: "flex" }} />
      <div style={{ position: "absolute", width: 210, height: 210, right: 160, bottom: -90, borderRadius: 999, border: "30px solid rgba(255,255,255,.10)", display: "flex" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 800 }}>
          <div style={{ width: 72, height: 72, borderRadius: 23, display: "flex", alignItems: "center", justifyContent: "center", background: "#b7f34a" }}><div style={{ width: 26, height: 26, border: "8px solid #10213a", borderRadius: 999, display: "flex" }} /></div>
          SIMKA
        </div>
        <div style={{ display: "flex", padding: "12px 22px", borderRadius: 999, background: "rgba(255,255,255,.14)", fontSize: 24, fontWeight: 700 }}>{product?.type || "SIM / eSIM"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 980, zIndex: 1 }}>
        <div style={{ display: "flex", fontSize: 26, color: "#dbeafe", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{destination}</div>
        <div style={{ display: "flex", fontSize: 62, lineHeight: 1.04, letterSpacing: "-2.5px", fontWeight: 900 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 29, color: "#eef6ff" }}>{details}</div>
      </div>
    </div>,
    size,
  );
}
