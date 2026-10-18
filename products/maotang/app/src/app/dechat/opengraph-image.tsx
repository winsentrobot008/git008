import { ImageResponse } from "next/og";

export const alt = "MAOTANG Human Coin Genesis claim card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "linear-gradient(135deg, #fff5f7 0%, #ffe3e9 100%)",
          color: "#4d2532",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: "64px 72px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#ffb6c1",
            borderRadius: "48px",
            display: "flex",
            height: "190px",
            opacity: 0.46,
            position: "absolute",
            right: "-42px",
            top: "-64px",
            width: "330px",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "18px", width: "900px" }}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: "12px",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                background: "#8f5568",
                borderRadius: "999px",
                display: "flex",
                height: "14px",
                width: "14px",
              }}
            />
            MAOTANG GENESIS
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.02 }}>
            Human Coin. Hardware claim.
          </div>
          <div style={{ display: "flex", fontSize: 30, lineHeight: 1.35, opacity: 0.74 }}>
            Face ID-gated testnet faucet with an on-chain claim receipt.
          </div>
        </div>
        <div style={{ display: "flex", gap: "18px" }}>
          {[
            ["8.3B", "HARD CAP"],
            ["FACE ID", "HARDWARE CHECK"],
            ["1.25x", "SHARE BONUS"],
          ].map(([value, label]) => (
            <div
              key={label}
              style={{
                background: "rgba(255,255,255,0.72)",
                border: "2px solid rgba(255,255,255,0.92)",
                borderRadius: "28px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "22px 28px",
              }}
            >
              <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>{value}</div>
              <div style={{ display: "flex", fontSize: 17, letterSpacing: "0.1em", opacity: 0.62 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
