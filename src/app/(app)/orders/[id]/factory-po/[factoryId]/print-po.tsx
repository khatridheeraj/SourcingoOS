"use client";

// On a phone the print screen has "Save as PDF", which makes the file to send to the factory.
export function PrintPo() {
  return (
    <div className="row no-print">
      <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
    </div>
  );
}
