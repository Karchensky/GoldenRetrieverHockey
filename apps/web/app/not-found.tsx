import Link from "next/link";

export const metadata = { title: "Not on file" };

export default function NotFound() {
  return (
    <div className="wrap page" style={{ minHeight: "70vh", display: "grid", alignContent: "center", gap: 18 }}>
      <span className="kicker">Error 404 · Not on file</span>

      <h1
        style={{
          fontFamily: "var(--disp)", fontWeight: 300, margin: 0,
          fontSize: "clamp(2rem,7vw,4.4rem)", lineHeight: 0.9, letterSpacing: "0.01em",
        }}
      >
        This one didn&rsquo;t
        <br />
        <span style={{ color: "var(--dim)", fontWeight: 200 }}>come back.</span>
      </h1>

      {/* "There is no page at this address." said, in plain English, what the
          404 above it and the headline beside it had each already said. */}
      <p style={{ margin: "6px 0 0" }}>
        <Link href="/" className="kicker" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 2 }}>
          ← Home
        </Link>
      </p>
    </div>
  );
}
