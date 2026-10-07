// Saves a QR card as a PNG: the on-screen QR (an <svg> from qrcode.react) with
// the booking details printed underneath, so a downloaded/printed copy is
// self-contained at check-in. Runs entirely in the browser (no server cost).
export const renderQrCardBlob = async (svg: SVGSVGElement, lines: string[]): Promise<Blob> => {
  const qrSize = 600;
  const pad = 40;
  const lineHeight = 34;
  const width = qrSize + pad * 2;
  const height = pad + qrSize + 24 + lines.length * lineHeight + pad;

  const svgText = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('QR image could not be drawn.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, pad, pad, qrSize, qrSize);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#112a41';
    lines.forEach((line, index) => {
      ctx.font = index === 0 ? 'bold 30px system-ui, sans-serif' : '24px system-ui, sans-serif';
      ctx.fillText(line, width / 2, pad + qrSize + 24 + lineHeight * (index + 0.8), width - pad * 2);
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const downloadQrCard = async (svg: SVGSVGElement, lines: string[], filename: string) => {
  const blob = await renderQrCardBlob(svg, lines);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
