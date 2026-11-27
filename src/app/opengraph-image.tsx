import { ImageResponse } from "next/og";

// The picture a shared link shows (WhatsApp, LinkedIn, email). Drawn here so it always matches the site's words.
export const alt = "Sourcingo: garment sourcing from India, watched at every step";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const stages = ["Costing", "Factory", "Plan", "Make", "Final QC", "Ship"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#f7f7f8", color: "#111216" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 700 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "#4f46e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>S</div>
          Sourcingo
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 22, color: "#4f46e5", letterSpacing: 3, fontWeight: 600 }}>GARMENT SOURCING FROM JAIPUR, INDIA</div>
          <div style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, display: "flex", flexDirection: "column" }}>
            <span>Your order, made in India.</span>
            <span style={{ color: "#4f46e5" }}>Watched at every step.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {stages.map((s, i) => (
            <div key={s} style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <div style={{ height: 10, borderRadius: 5, background: i < 3 ? "#157a46" : i === 3 ? "#4f46e5" : "#e7e7eb" }} />
              <div style={{ fontSize: 20, color: "#6a6d78" }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
