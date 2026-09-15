import { ImageResponse } from "next/og";

export const alt = "SIMKA — SIM и eSIM для путешествий";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(135deg, #10213a 0%, #1168e8 70%, #42a5f5 100%)", color: "white", padding: "72px", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "22px", fontSize: 40, fontWeight: 800 }}>
        <div style={{ width: 76, height: 76, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "#b7f34a" }}><div style={{ width: 28, height: 28, border: "8px solid #10213a", borderRadius: 999 }} /></div>
        SIMKA
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
        <div style={{ maxWidth: 940, fontSize: 72, lineHeight: 1.02, letterSpacing: "-3px", fontWeight: 900 }}>eSIM и SIM для путешествий</div>
        <div style={{ fontSize: 30, color: "#dbeafe" }}>Тарифы по странам · Понятные условия · Оформление онлайн</div>
      </div>
    </div>,
    size,
  );
}
