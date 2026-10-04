"use client";

export function PrintButton() {
  return (
    <>
      <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      <button type="button" className="btn" onClick={() => history.back()}>Back</button>
    </>
  );
}
