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

  if (factor < 1) {
    for (const elem of svg.querySelectorAll('[font-size]')) {
      const size = Number.parseFloat(elem.getAttribute('font-size') ?? '');
      elem.setAttribute('font-size', String(size * factor));
    }
  }
  joinRuns(texts, pdf);
  for (const text of texts) {
    text.removeAttribute('textLength');
  }
}

function num(elem: Element, attr: string): number {
  return Number.parseFloat(elem.getAttribute(attr) ?? '');
}

function isCentered(elem: Element): boolean {
  return elem.getAttribute('text-anchor') === 'middle';
}

/* Start of text on screen (placed at its start or middle, unrotated) */
function getStart(elem: Element): number {
  return num(elem, 'x') - (isCentered(elem) ? num(elem, 'textLength') / 2 : 0);
}

/* Text placed as `textToSvg` and `flattenText` place runs of text */
function isRun(elem: Element): boolean {
  return (
    !elem.hasAttribute('transform') &&
    ['start', 'middle', null].includes(elem.getAttribute('text-anchor')) &&
    Number.isFinite(num(elem, 'x')) &&
    Number.isFinite(num(elem, 'y'))
  );
}

function isBold(elem: Element): boolean {
  return elem.closest('[font-weight]')?.getAttribute('font-weight') === 'bold';
}

/* Runs of a line of text (e.g. `ψ`, subscript `3,0`, `, elliptic formula`) one after the other in
 * the embedded font, as it is narrower or wider than on screen (else with gaps or overlapping),
 * centred where the line was */
function joinRuns(texts: Element[], pdf: JsPdf) {
  pdf.setFont(FONT, 'bold');
  const boldFont = pdf.getFont();
  pdf.setFont(FONT, 'normal');
  const normalFont = pdf.getFont();
  function width(elem: Element): number {
    const font = isBold(elem) ? boldFont : normalFont;
    return (
      pdf.getStringUnitWidth(elem.textContent, { font }) * getFontSize(elem)
    );
  }

  const lines: Element[][] = [];
  texts.filter(isRun).forEach((text, i, runs) => {
    const prev = runs[i - 1] as Element | undefined;
    const size = getFontSize(text);
    const gap = prev
      ? getStart(text) - getStart(prev) - num(prev, 'textLength')
      : Infinity;
    const isNext =
      prev?.parentElement === text.parentElement &&
      gap > -1 &&
      gap < size * 0.6 &&
      Math.abs(num(text, 'y') - num(prev, 'y')) < size;
    if (isNext) {
      lines[lines.length - 1].push(text);
    } else {
      lines.push([text]);
    }
  });

  for (const line of lines.filter((runs) => runs.length > 1)) {
    const [first] = line;
    const last = line[line.length - 1];
    const start = getStart(first);
    const screenWidth = getStart(last) + num(last, 'textLength') - start;
    let x = 0;
    const offsets = line.map((run, i) => {
      if (i > 0) {
        const prev = line[i - 1];
        const gap = getStart(run) - getStart(prev) - num(prev, 'textLength');
        x += width(prev) + Math.max(gap, 0);
      }
      return x;
    });
    const total = x + width(last);
    const shift = start + (screenWidth - total) / 2;
    line.forEach((run, i) => {
      const middle = isCentered(run) ? width(run) / 2 : 0;
      run.setAttribute('x', String(offsets[i] + shift + middle));
    });
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
