/**
 * Renders a PDF's pages to PNG files in the browser (pdf.js, loaded on demand so it
 * never ships to visitors). Used by CMS uploads so the public site can show the
 * pages as plain images in the zoomable popup.
 */
const TARGET_WIDTH = 2000;
const MAX_PAGES = 12;

export async function renderPdfToPngFiles(file: File): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const baseName = file.name.replace(/\.pdf$/i, '') || 'halaman';
  const out: File[] = [];
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, TARGET_WIDTH / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Gagal menukar halaman PDF kepada imej.');
      out.push(new File([blob], `${baseName}-p${n}.png`, { type: 'image/png' }));
      canvas.width = canvas.height = 0;
    }
  } finally {
    await pdf.destroy();
  }
  return out;
}
