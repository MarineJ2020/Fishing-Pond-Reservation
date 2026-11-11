/**
 * One QR per page (label printer): each card fills a whole page, so every peg
 * comes out as its own label, as large as the label allows. Shared by the CMS
 * QR viewer and the customer's booking detail so both print the same template.
 * Each tile is a DOM element holding an <svg> and a `data-lines` attribute
 * (first line bold, the rest regular). Returns false when nothing was printed.
 */
export const printQrTiles = (tiles: Element[], title: string): boolean => {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cards = tiles.map((tile) => {
    const svg = tile.querySelector('svg');
    const lines = (tile.getAttribute('data-lines') || '').split('\n');
    return `<div class="card">${svg ? new XMLSerializer().serializeToString(svg) : ''}<b>${esc(lines[0] || '')}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
  }).join('');
  if (!cards) { alert('Sila pilih sekurang-kurangnya satu QR.'); return false; }
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up disekat. Benarkan pop-up untuk mencetak, atau muat turun QR satu per satu.'); return false; }
  w.document.write(`<!doctype html><title>QR ${esc(title)}</title><style>
    @page{margin:0}
    html,body{margin:0;padding:0}
    body{font-family:system-ui,sans-serif;color:#112a41}
    .card{box-sizing:border-box;width:100vw;height:100vh;padding:8.8vmin 4vmin 4vmin;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-after:page;page-break-after:always;overflow:hidden}
    .card:last-child{break-after:auto;page-break-after:auto}
    .card svg{width:min(88vw,62vh);height:min(88vw,62vh)}
    .card b{display:block;font-size:6.6vmin;line-height:1;height:6vmin;margin-top:2vmin}
    .card span{display:block;font-size:4.4vmin;line-height:1;height:3.84vmin;margin-top:2.2vmin}
  </style>${cards}<script>window.onload=function(){window.print()}<\/script>`);
  w.document.close();
  return true;
};
