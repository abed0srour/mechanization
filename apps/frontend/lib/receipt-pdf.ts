/**
 * Turning the on-screen وصل قبض into a real PDF file.
 *
 * ── Why raster, not text ────────────────────────────────────────────────
 *
 * The receipt is rasterised by `html2canvas` and the bitmap placed into a PDF,
 * rather than written as PDF text runs. That is deliberate: jsPDF has no
 * Arabic shaping engine, so `بلدية البازورية` written as text comes out as
 * disconnected, left-to-right letterforms — `ب ل د ي ة` — unless you embed a
 * font *and* run bidi + glyph substitution yourself. The browser has already
 * done all of that to paint the element; photographing its output preserves it
 * exactly.
 *
 * The cost is that the PDF's text is not selectable or searchable. For a
 * receipt that is a facsimile of a paper book — filled in, signed by hand and
 * filed — that is the same trade a scanner makes, and the right one here.
 *
 * ── Why this is loaded lazily ───────────────────────────────────────────
 *
 * `jspdf` + `html2canvas` are ~200 kB gzipped between them. A clerk opens a
 * receipt a few times a day; every other page in the portal would otherwise
 * carry that weight on first load. The dynamic `import()` inside the function
 * keeps both out of the initial bundle and off every route that never prints.
 */

/** A4 landscape at 96 dpi, which is what the receipt's layout is drawn for. */
const PAGE = { width: 297, height: 210 } as const;

/**
 * Renders `element` to a one-page PDF and returns it as a `File`.
 *
 * A `File` rather than a `Blob` because `navigator.share` requires one — the
 * share sheet needs a name and a MIME type to hand WhatsApp, and a bare Blob
 * is rejected by `canShare`.
 */
export async function renderReceiptPdf(
  element: HTMLElement,
  fileName: string,
): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const dpr = typeof window !== 'undefined' ? Math.max(2, window.devicePixelRatio || 2) : 2;
  const canvas = await html2canvas(element, {
    // 2× minimum so the print is not visibly soft — a receipt is read at arm's length
    // on paper, where a 1× rasterisation of 11px Arabic is mush.
    scale: dpr,
    // The receipt is deliberately black-on-white regardless of the dashboard's
    // theme; without this the dark-mode surface bleeds through as a black page.
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Fit the capture inside the page while preserving its aspect ratio, then
  // centre it. Stretching to the page would distort the form's rules and boxes.
  const margin = 10;
  const maxWidth = PAGE.width - margin * 2;
  const maxHeight = PAGE.height - margin * 2;
  const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
  const width = canvas.width * ratio;
  const height = canvas.height * ratio;

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    (PAGE.width - width) / 2,
    (PAGE.height - height) / 2,
    width,
    height,
  );

  const blob = pdf.output('blob');
  return new File([blob], fileName, { type: 'application/pdf' });
}

/**
 * Hands a file to the OS share sheet — which on a phone, and on desktops with
 * WhatsApp installed, includes WhatsApp itself.
 *
 * **This is the only way a `wa.me`-based flow can carry an actual attachment.**
 * A `wa.me` link takes a `text` parameter and nothing else; there is no
 * parameter for a file, and no amount of URL construction adds one. The Web
 * Share API is the browser's own hand-off to a native app, so the PDF goes
 * across as a document rather than as a link to one.
 *
 * Returns false when the browser cannot share files (Firefox, and most desktop
 * browsers without a share target), so the caller can fall back rather than
 * silently doing nothing.
 */
export async function shareFile(file: File, text: string): Promise<boolean> {
  // `canShare` must be asked about the *actual* payload: a browser can support
  // `share` for text and still refuse files, and calling `share` regardless
  // throws a TypeError the user would see as a broken button.
  if (typeof navigator === 'undefined' || !navigator.canShare?.({ files: [file] })) {
    return false;
  }

  try {
    await navigator.share({ files: [file], text });
    return true;
  } catch (error) {
    // A user dismissing the sheet raises AbortError. That is not a failure and
    // must not trigger the "sharing did not work" fallback — re-opening a
    // download they just cancelled is worse than doing nothing.
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return false;
  }
}

/** Saves the PDF to disk, for the fallback path. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  // Revoked on the next tick rather than immediately: Safari has not finished
  // reading the blob when `click()` returns, and revoking synchronously there
  // produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
