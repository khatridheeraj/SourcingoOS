// Shrinks a big PDF (usually a scanned QC report) in the browser before it is uploaded.
// Each page is redrawn as a JPEG at about 150 dpi, which keeps scans readable at a fraction of the size.
// The original is kept when the PDF is already small, can't be read, or doesn't get meaningfully smaller.

// QC reports filled a quarter of the free 1 GB file storage in two days at about 190 dpi, so pages are drawn smaller.
const SHRINK_FROM = 1024 * 1024;
const LONG_SIDE = 1750; // pixels on a page's longer side; A4 at about 150 dpi, still clear for printed and handwritten text
const QUALITY = 0.65;

export async function shrinkPdf(file: File): Promise<File> {
  if (file.size < SHRINK_FROM) return file;
  try {
    const [pdfjs, { PDFDocument }] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdf-lib")]);
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const src = await task.promise;
    const out = await PDFDocument.create();
    const canvas = document.createElement("canvas");
    try {
      for (let n = 1; n <= src.numPages; n++) {
        const page = await src.getPage(n);
        const size = page.getViewport({ scale: 1 }); // in points, rotation applied
        const viewport = page.getViewport({ scale: Math.min(3, LONG_SIDE / Math.max(size.width, size.height)) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: "#fff" }).promise;
        page.cleanup();
        const jpeg = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/jpeg", QUALITY));
        const img = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
        out.addPage([size.width, size.height]).drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
      }
    } finally {
      await task.destroy();
      canvas.width = canvas.height = 0;
    }
    const bytes = await out.save();
    // Keep the original unless the copy saves at least a fifth.
    if (bytes.byteLength > file.size * 0.8) return file;
    return new File([bytes as BlobPart], file.name, { type: "application/pdf" });
  } catch (err) {
    console.warn(`Couldn't shrink ${file.name}; uploading it as it is.`, err);
    return file;
  }
}
