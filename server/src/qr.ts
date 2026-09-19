// QR code as a standalone SVG string (dark modules on a white quiet zone, so it
// scans regardless of the page theme). Uses the zero-dependency `qrcode-generator`.

import qrcode from "qrcode-generator";

/** Boolean module matrix (true = dark), without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M"); // type 0 = smallest version that fits; error correction level M
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

const QUIET_ZONE = 4; // modules; required by the QR spec for reliable scanning

export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  const size = m.length + QUIET_ZONE * 2;
  let d = "";
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (m[r]![c]) d += `M${c + QUIET_ZONE},${r + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}
