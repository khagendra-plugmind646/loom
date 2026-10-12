import { ImageResponse } from "next/og";

// Link preview for X, Telegram, Discord etc. (also used as the Twitter card, see twitter-image.tsx).
export const alt = "Loomzk: borrow dollars against your SOL. Verify every step.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const pills = ["12% a year, only while you borrow", "8% with a ZK credit certificate", "Pyth + Chainlink oracles", "Live on Solana devnet"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0b0f19 0%, #121a33 55%, #0e2a2a 100%)",
          color: "#e9ecf5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "linear-gradient(135deg, #7c5cff, #14b8a6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
              color: "white",
            }}
          >
            L
          </div>
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ fontSize: 40, fontWeight: 700 }}>Loom</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#8b7bff", marginLeft: 2 }}>zk</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Borrow dollars against your SOL.</div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: "#8b7bff" }}>Verify every step.</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {pills.map((p) => (
            <div key={p} style={{ display: "flex", padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,0.08)", fontSize: 26, color: "#c9cfe0" }}>
              {p}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
