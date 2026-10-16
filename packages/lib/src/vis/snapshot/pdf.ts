/* Loaded on first PDF export, to keep jsPDF and svg2pdf.js out of the main bundle */
import { jsPDF as JsPdf } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

import { DEJAVU_SANS_BASE64, DEJAVU_SANS_BOLD_BASE64 } from './dejaVuSans';

const PT_PER_PX = 0.75; // 1 CSS pixel = 1/96 in = 0.75 pt
const FONT = 'DejaVuSans';
const MIN_FONT_FACTOR = 0.8; // DejaVu Sans is a little wider than most sans-serif fonts

function getFontSize(elem: Element): number {
  for (let node: Element | null = elem; node; node = node.parentElement) {
    const size = Number.parseFloat(node.getAttribute('font-size') ?? '');
    if (size > 0) {
      return size;
    }
  }
  return 16;
}

/* Use the embedded font (normal or bold) whatever the family, weight and style, as
 * svg2pdf falls back to the standard fonts otherwise, and shrink text if it is longer than on screen */
function prepareText(svg: SVGSVGElement, pdf: JsPdf) {
  for (const elem of svg.querySelectorAll('[font-family]')) {
    elem.setAttribute('font-family', FONT);
  }
  for (const elem of svg.querySelectorAll('[font-weight]')) {
    const weight = Number(elem.getAttribute('font-weight')) || 400;
    elem.setAttribute('font-weight', weight >= 600 ? 'bold' : 'normal');
  }
  for (const elem of svg.querySelectorAll('[font-style]')) {
    elem.removeAttribute('font-style');
  }

  // One factor for all text, to keep sizes consistent (within limits for long text)
  const texts = [...svg.querySelectorAll('text[textLength]')];
  const ratios = texts
    .map((text) => {
      const length = Number.parseFloat(text.getAttribute('textLength') ?? '');
      const width =
        pdf.getStringUnitWidth(text.textContent, { font: pdf.getFont() }) *
        getFontSize(text);
      return length / width;
    })
    .filter((ratio) => ratio > 0 && Number.isFinite(ratio))
    .toSorted((a, b) => a - b);
  const factor = Math.min(1, Math.max(MIN_FONT_FACTOR, ratios[0] ?? 1));

  for (const text of texts) {
    text.removeAttribute('textLength');
  }
  if (factor < 1) {
    for (const elem of svg.querySelectorAll('[font-size]')) {
      const size = Number.parseFloat(elem.getAttribute('font-size') ?? '');
      elem.setAttribute('font-size', String(size * factor));
    }
  }
}

/* PDF of an SVG snapshot, of the same size; text is in an embedded subset of DejaVu
 * Sans, as the standard PDF fonts only cover Latin-1 */
export async function svgToPdf(svg: SVGSVGElement): Promise<Blob> {
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || 1;
  const height = Number.parseFloat(svg.getAttribute('height') ?? '') || 1;
  const [w, h] = [width * PT_PER_PX, height * PT_PER_PX];

  const pdf = new JsPdf({
    unit: 'pt',
    format: [w, h],
    orientation: w > h ? 'landscape' : 'portrait',
    compress: true,
  });
  pdf.addFileToVFS(`${FONT}.ttf`, DEJAVU_SANS_BASE64);
  pdf.addFileToVFS(`${FONT}-Bold.ttf`, DEJAVU_SANS_BOLD_BASE64);
  pdf.addFont(`${FONT}.ttf`, FONT, 'normal');
  pdf.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  pdf.setFont(FONT, 'normal');

  // svg2pdf reads attributes and styles of elements in a document
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: -100000px; top: 0;';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  prepareText(clone, pdf);
  container.append(clone);
  document.body.append(container);
  try {
    await svg2pdf(clone, pdf, { x: 0, y: 0, width: w, height: h });
  } finally {
    container.remove();
  }

  return pdf.output('blob');
}
