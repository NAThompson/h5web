import { expandScrollers, getCanvasPanels } from './panels';
import { isRendered, SNAPSHOT_ATTR, SNAPSHOT_IGNORE_ATTR } from './render';
import {
  type Attrs,
  canvasToSvg,
  createSvgElement,
  panelsToSvg,
  type SceneContext,
} from './svgScene';
import {
  collapseWhitespace,
  fmt,
  getGenericFontFamily,
  getRepeatingStripes,
  parseClipPolygon,
} from './svgUtils';
import { getColorAlpha, parseLinearGradient } from './utils';

export interface SvgSnapshotOptions {
  /* Defaults to white (light theme, whatever the colour scheme); `null` for transparent */
  background?: string | null;
  /* Pixels per CSS pixel of raster parts (e.g. heatmaps); defaults to 2-3 */
  rasterScale?: number;
}

interface Context extends SceneContext {
  origin: DOMRect;
  withTextLength: boolean; // on-screen length of text, to fit other fonts (PDF)
}

// Properties written as presentation attributes of exported SVG elements
const INHERITED_PROPS = `fill fill-opacity fill-rule stroke stroke-width
  stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap
  stroke-linejoin font-size font-weight font-style text-anchor
  visibility`.split(/\s+/u);
const SKIPPED_ATTRS = new RegExp(
  `^(class|style|data-.*|aria-.*|role|tabindex|on.*|${[
    ...INHERITED_PROPS,
    'font-family',
    'opacity',
    'color',
    'dominant-baseline',
    'alignment-baseline',
    'baseline-shift',
  ].join('|')})$`,
  'u',
); // replaced by computed values
const SKIPPED_TAGS = new Set([
  'title',
  'desc',
  'foreignObject',
  'script',
  'style',
]);

let normalizingCtx: CanvasRenderingContext2D | null | undefined;

/* Canonical form of a CSS colour (`#rrggbb` or `rgba(...)`) */
function normalizeColor(color: string): string {
  normalizingCtx =
    normalizingCtx ?? document.createElement('canvas').getContext('2d');
  if (!normalizingCtx) {
    return color;
  }
  normalizingCtx.fillStyle = '#000';
  normalizingCtx.fillStyle = color;
  return normalizingCtx.fillStyle;
}

/* `rgba()` colour as opaque colour and alpha, which all SVG renderers understand */
function splitAlpha(color: string): [string, number] {
  const alpha = getColorAlpha(color);
  const match = /^rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)$/u.exec(color);
  return [match ? `rgb(${match[1]},${match[2]},${match[3]})` : color, alpha];
}

const THEME_COLOR_PROPS = ['--curve-color', '--aux-colors'];

function readThemeColors(elem: Element): string[] {
  const style = getComputedStyle(elem);
  return THEME_COLOR_PROPS.flatMap((prop) =>
    style
      .getPropertyValue(prop)
      .split(',')
      .map((color) => color.trim())
      .filter(Boolean),
  );
}

/* Dark-mode line colours (e.g. `--h5w-line--color`) to their light-mode values,
 * found on a copy of the visualization outside of the dark-mode container */
function getThemeColors(root: HTMLElement): Map<string, string> {
  const map = new Map<string, string>();
  const figures = new Set([
    ...(root.matches('figure') ? [root] : []),
    ...root.querySelectorAll('figure'),
  ]);

  for (const figure of figures) {
    const dark = readThemeColors(figure);
    if (dark.length === 0) {
      continue;
    }

    const probe = document.createElement(figure.tagName);
    probe.className = figure.className;
    probe.style.display = 'none';
    document.body.append(probe);
    const light = readThemeColors(probe);
    probe.remove();

    dark.forEach((color, i) => {
      if (light[i] && normalizeColor(color) !== normalizeColor(light[i])) {
        map.set(normalizeColor(color), normalizeColor(light[i]));
      }
    });
  }
  return map;
}

const fontMetrics = new Map<string, [number, number]>();

/* Ascent and descent of a font, as used to lay out lines of text */
function getFontMetrics(style: CSSStyleDeclaration): [number, number] {
  const { fontStyle, fontWeight, fontSize, fontFamily } = style;
  const font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
  const cached = fontMetrics.get(font);
  if (cached) {
    return cached;
  }

  normalizingCtx =
    normalizingCtx ?? document.createElement('canvas').getContext('2d');
  const size = Number.parseFloat(fontSize);
  let metrics: [number, number] = [size * 0.8, size * 0.2];
  if (normalizingCtx) {
    normalizingCtx.font = font;
    const m = normalizingCtx.measureText('Mg');
    metrics = [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent];
  }
  fontMetrics.set(font, metrics);
  return metrics;
}

function fontAttrs(style: CSSStyleDeclaration, scale = 1): Attrs {
  return {
    'font-family': getGenericFontFamily(style.fontFamily),
    'font-size': Number.parseFloat(style.fontSize) * scale,
    'font-weight': style.fontWeight === '400' ? undefined : style.fontWeight,
    'font-style': style.fontStyle === 'normal' ? undefined : style.fontStyle,
  };
}

function colorAttrs(
  color: string,
  prop: 'fill' | 'stroke',
  ctx: Context,
  opacity = 1,
): Attrs {
  const [opaque, alpha] = splitAlpha(ctx.mapColor(color));
  const totalAlpha = alpha * opacity;
  return {
    [prop]: opaque,
    [`${prop}-opacity`]: totalAlpha < 1 ? totalAlpha : undefined,
  };
}

/* Inline computed styles of an element of an SVG, where they differ from its parent's */
function copyPresentation(
  out: SVGElement,
  style: CSSStyleDeclaration,
  parentStyle: CSSStyleDeclaration | undefined,
  ctx: Context,
) {
  for (const prop of INHERITED_PROPS) {
    let value = style.getPropertyValue(prop);
    if (!value || parentStyle?.getPropertyValue(prop) === value) {
      continue;
    }
    if ((prop === 'fill' || prop === 'stroke') && /^(?:rgb|#)/u.test(value)) {
      const attrs = colorAttrs(value, prop, ctx);
      Object.entries(attrs).forEach(([name, val]) => {
        if (val !== undefined) {
          out.setAttribute(name, String(val));
        }
      });
      continue;
    }
    if (prop === 'stroke-dasharray' && value !== 'none') {
      value = value.replaceAll(/px|,/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
    }
    out.setAttribute(prop, value.replace(/px$/u, ''));
  }

  const family = getGenericFontFamily(style.fontFamily);
  if (!parentStyle || getGenericFontFamily(parentStyle.fontFamily) !== family) {
    out.setAttribute('font-family', family);
  }

  if (style.opacity !== '1') {
    out.setAttribute('opacity', style.opacity);
  }
}

/* Text of an SVG `text` element as one `text` per run of same-styled characters, each
 * at its position on screen (resolving `dy`, baselines and anchors, which not all
 * renderers support) and with its length on screen (in case of different fonts) */
function flattenText(
  orig: SVGTextElement,
  out: SVGElement,
  ctx: Context,
): boolean {
  const count = orig.getNumberOfChars();
  const walker = document.createTreeWalker(orig, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.parentElement?.closest('title, desc') ?? false)) {
      nodes.push(node as Text);
    }
  }

  const texts = collapseWhitespace(nodes.map((node) => node.data));
  if (count === 0 || texts.join('').length !== count) {
    return false;
  }

  const textStyle = getComputedStyle(orig);
  const anchor = textStyle.getPropertyValue('text-anchor');
  out.removeAttribute('text-anchor');

  let offset = 0;
  texts.forEach((text, i) => {
    if (text.trim() === '') {
      offset += text.length;
      return;
    }

    const elem = nodes[i].parentElement ?? orig;
    const style = getComputedStyle(elem);
    const start = offset + text.length - text.trimStart().length;
    const first = orig.getExtentOfChar(start);
    const last = orig.getExtentOfChar(offset + text.trimEnd().length - 1);
    offset += text.length;

    const [asc, desc] = getFontMetrics(style);
    const length = last.x + last.width - first.x;
    const isSingle = texts.filter((t) => t.trim() !== '').length === 1;
    const x =
      isSingle && anchor === 'middle'
        ? first.x + length / 2
        : isSingle && anchor === 'end'
          ? first.x + length
          : first.x;

    const run = createSvgElement('text', {
      x,
      y: first.y + (first.height * asc) / (asc + desc),
      'text-anchor': isSingle && anchor !== 'start' ? anchor : undefined,
      textLength: ctx.withTextLength && length > 0 ? length : undefined,
    });
    if (elem !== orig) {
      copyPresentation(run, style, textStyle, ctx);
    }
    run.textContent = text.trim();

    // Halo (e.g. overlay labels): stroke below fill, as not all renderers support `paint-order`
    const hasHalo =
      style.getPropertyValue('paint-order').startsWith('stroke') &&
      style.getPropertyValue('stroke') !== 'none';
    if (hasHalo) {
      const halo = run.cloneNode(true) as SVGElement;
      halo.setAttribute('fill', 'none');
      run.setAttribute('stroke', 'none');
      out.append(halo);
    }
    out.append(run);
  });

  return true;
}

/* Fallback for text that can't be flattened: as is */
function copyText(orig: Element): SVGElement {
  const text = createSvgElement('text');
  for (const name of ['x', 'y', 'dx', 'dy']) {
    const value = orig.getAttribute(name);
    if (value) {
      text.setAttribute(name, value);
    }
  }
  text.textContent = orig.textContent;
  return text;
}

function cloneSvgNode(
  orig: Element,
  parentStyle: CSSStyleDeclaration | undefined,
  ctx: Context,
): SVGElement | undefined {
  const tag = orig.localName;
  if (SKIPPED_TAGS.has(tag) || orig.hasAttribute(SNAPSHOT_IGNORE_ATTR)) {
    return undefined;
  }

  const style = getComputedStyle(orig);
  if (style.display === 'none') {
    return undefined;
  }

  const isText = tag === 'text';
  const out = createSvgElement(isText ? 'g' : tag);
  for (const { name, value } of orig.attributes) {
    if (
      !SKIPPED_ATTRS.test(name) &&
      !(isText && /^(?:dx|dy|transform|x|y)$/u.test(name))
    ) {
      out.setAttribute(name, value);
    }
  }
  copyPresentation(out, style, parentStyle, ctx);
  if (tag === 'svg') {
    out.setAttribute(
      'overflow',
      style.overflow === 'visible' ? 'visible' : 'hidden',
    );
  }

  if (isText) {
    const transform = orig.getAttribute('transform');
    if (transform) {
      out.setAttribute('transform', transform);
    }
    if (!flattenText(orig as SVGTextElement, out, ctx)) {
      out.append(copyText(orig));
    }
    return out;
  }

  for (const child of orig.childNodes) {
    if (child instanceof Element) {
      const clone = cloneSvgNode(child, style, ctx);
      if (clone) {
        out.append(clone);
      }
    } else if (child instanceof Text && child.data.trim()) {
      out.append(child.data);
    }
  }
  return out;
}

/* Top-level SVG of the visualization (axes, grid, overlays...) as a group */
function svgToSvg(svg: SVGSVGElement, ctx: Context): SVGElement {
  const rect = svg.getBoundingClientRect();
  const style = getComputedStyle(svg);
  const width = Number.parseFloat(style.width) || rect.width; // untransformed size
  const height = Number.parseFloat(style.height) || rect.height;
  const [sx, sy] = [rect.width / width, rect.height / height]; // CSS transform scale

  const transforms = [
    `translate(${fmt(rect.x - ctx.origin.x)} ${fmt(rect.y - ctx.origin.y)})`,
  ];
  if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) {
    transforms.push(`scale(${fmt(sx)} ${fmt(sy)})`);
  }
  const group = createSvgElement('g', { transform: transforms.join(' ') });

  if (style.overflow !== 'visible') {
    const clip = createSvgElement('clipPath');
    clip.append(createSvgElement('rect', { width, height }));
    group.setAttribute('clip-path', ctx.define(clip));
  }

  const content = createSvgElement('g');
  const viewBox = svg.viewBox.baseVal as DOMRect | null;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    // Default `preserveAspectRatio` (`xMidYMid meet`)
    const scale = Math.min(width / viewBox.width, height / viewBox.height);
    const tx = (width - viewBox.width * scale) / 2 - viewBox.x * scale;
    const ty = (height - viewBox.height * scale) / 2 - viewBox.y * scale;
    content.setAttribute(
      'transform',
      `translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(scale)})`,
    );
  }

  copyPresentation(content, style, undefined, ctx);
  for (const child of svg.children) {
    const clone = cloneSvgNode(child, style, ctx);
    if (clone) {
      content.append(clone);
    }
  }

  group.append(content);
  return group;
}

function relativeRect(
  elem: { getBoundingClientRect: () => DOMRect },
  ctx: Context,
) {
  const { x, y, width, height } = elem.getBoundingClientRect();
  return { x: x - ctx.origin.x, y: y - ctx.origin.y, width, height };
}

/* Background, gradient and border of an HTML element */
function boxToSvg(
  elem: HTMLElement,
  style: CSSStyleDeclaration,
  opacity: number,
  ctx: Context,
): SVGElement[] {
  const { x, y, width, height } = relativeRect(elem, ctx);
  const { backgroundColor, backgroundImage, borderTopColor } = style;
  const radius = Number.parseFloat(style.borderTopLeftRadius) || undefined;
  const polygon = parseClipPolygon(style.clipPath, width, height);
  function shape(attrs: Attrs): SVGElement {
    return polygon
      ? createSvgElement('polygon', {
          points: polygon
            .map(([px, py]) => `${fmt(x + px)},${fmt(y + py)}`)
            .join(' '),
          ...attrs,
        })
      : createSvgElement('rect', { x, y, width, height, rx: radius, ...attrs });
  }

  const elems: SVGElement[] = [];
  if (getColorAlpha(backgroundColor) > 0) {
    elems.push(shape(colorAttrs(backgroundColor, 'fill', ctx, opacity)));
  }

  const gradient = parseLinearGradient(backgroundImage);
  if (gradient) {
    const { direction, stops } = gradient;
    const gradientElem = createSvgElement('linearGradient', {
      x1: direction === 'left' ? 1 : 0,
      y1: direction === 'top' ? 1 : 0,
      x2: direction === 'right' ? 1 : 0,
      y2: direction === 'bottom' ? 1 : 0,
    });
    for (const { offset, color } of stops) {
      const [opaque, alpha] = splitAlpha(ctx.mapColor(color));
      gradientElem.append(
        createSvgElement('stop', {
          offset,
          'stop-color': opaque,
          'stop-opacity': alpha < 1 ? alpha : undefined,
        }),
      );
    }
    elems.push(
      shape({
        fill: ctx.define(gradientElem),
        'fill-opacity': opacity < 1 ? opacity : undefined,
      }),
    );
  }

  // Repeating stripes (e.g. dashed legend marks)
  const { direction, stripes } = getRepeatingStripes(
    backgroundImage,
    backgroundImage.includes('to bottom') ? height : width,
  );
  for (const [start, end, color] of stripes) {
    elems.push(
      createSvgElement('rect', {
        ...(direction === 'right'
          ? { x: x + start, y, width: end - start, height }
          : { x, y: y + start, width, height: end - start }),
        ...colorAttrs(color, 'fill', ctx, opacity),
      }),
    );
  }

  const border = Math.max(
    ...['top', 'right', 'bottom', 'left'].map((side) =>
      style.getPropertyValue(`border-${side}-style`) === 'none'
        ? 0
        : Number.parseFloat(style.getPropertyValue(`border-${side}-width`)),
    ),
  );
  if (border > 0 && getColorAlpha(borderTopColor) > 0) {
    // Drawn uniformly, with the top border's colour
    elems.push(
      createSvgElement('rect', {
        x: x + border / 2,
        y: y + border / 2,
        width: width - border,
        height: height - border,
        rx: radius,
        fill: 'none',
        'stroke-width': border,
        ...colorAttrs(borderTopColor, 'stroke', ctx, opacity),
      }),
    );
  }

  return elems;
}

/* Rotation (degrees) and scale of an element's text from its and its ancestors' CSS
 * transforms and writing mode (e.g. vertical colour bar label) */
function getTextTransform(elem: HTMLElement, root: HTMLElement) {
  let angle = 0;
  let scale = 1;
  for (let node: HTMLElement | null = elem; node; node = node.parentElement) {
    const { transform } = getComputedStyle(node);
    if (transform !== 'none') {
      const { a, b } = new DOMMatrixReadOnly(transform);
      angle += (Math.atan2(b, a) * 180) / Math.PI;
      scale *= Math.hypot(a, b);
    }
    if (node === root) {
      break;
    }
  }

  const { writingMode } = getComputedStyle(elem);
  if (
    writingMode.startsWith('vertical') ||
    writingMode.startsWith('sideways')
  ) {
    angle += writingMode === 'sideways-lr' ? -90 : 90;
  }
  return { angle: (((angle % 360) + 540) % 360) - 180, scale };
}

function isCentered(style: CSSStyleDeclaration): boolean {
  return (
    style.textAlign === 'center' ||
    (style.display.includes('flex') && style.justifyContent === 'center')
  );
}

/* Text node of an HTML element, one `text` per line */
function textToSvg(
  node: Text,
  elem: HTMLElement,
  style: CSSStyleDeclaration,
  opacity: number,
  ctx: Context & { root: HTMLElement },
): SVGElement[] {
  const start = node.data.search(/\S/u);
  if (start === -1) {
    return [];
  }
  const end = node.data.trimEnd().length;

  // Split into lines (e.g. wrapped text) by the vertical position of each character
  const range = document.createRange();
  const lines: [number, number][] = [];
  let lineTop: number | undefined;
  range.setStart(node, start);
  range.setEnd(node, end);
  if (range.getClientRects().length > 1) {
    for (let i = start; i < end; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const { top, height } = range.getBoundingClientRect();
      if (height > 0 && (lineTop === undefined || top > lineTop + height / 2)) {
        lines.push([i, i + 1]);
        lineTop = top;
      } else if (lines.length > 0) {
        lines[lines.length - 1][1] = i + 1;
      }
    }
  } else {
    lines.push([start, end]);
  }

  const { angle, scale } = getTextTransform(elem, ctx.root);
  const [asc, desc] = getFontMetrics(style);
  const textAttrs = {
    ...fontAttrs(style, scale),
    ...colorAttrs(style.color, 'fill', ctx, opacity),
  };

  return lines.flatMap(([from, to]) => {
    range.setStart(node, from);
    range.setEnd(node, to);
    const text = range.toString().replaceAll(/\s+/gu, ' ').trim();
    const { x, y, width, height } = relativeRect(range, ctx);
    if (!text || width === 0 || height === 0) {
      return [];
    }

    const isRotated = Math.abs(angle) > 0.5;
    const [cx, cy] = [x + width / 2, y + height / 2];
    const offset = ((asc - desc) / 2) * scale; // from middle of line box to baseline
    const length = isRotated ? Math.max(width, height) : width;

    const elemOut = createSvgElement('text', {
      ...(isRotated
        ? {
            transform: `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(angle)})`,
            x: 0,
            y: offset,
            'text-anchor': 'middle',
          }
        : isCentered(style) &&
            elem.textContent.replaceAll(/\s+/gu, ' ').trim() === text
          ? { x: cx, y: cy + offset, 'text-anchor': 'middle' }
          : { x, y: cy + offset }),
      textLength: ctx.withTextLength ? length : undefined,
      ...textAttrs,
    });
    elemOut.textContent = text;
    return [elemOut];
  });
}

/* HTML boxes and text (title, colour bar, legend, annotations...) in document order */
function collectHtml(
  elem: HTMLElement,
  out: SVGElement,
  opacity: number,
  ctx: Context & { root: HTMLElement },
) {
  const style = getComputedStyle(elem);
  if (
    style.display === 'none' ||
    elem instanceof HTMLCanvasElement ||
    elem.hasAttribute(SNAPSHOT_IGNORE_ATTR)
  ) {
    return;
  }

  const ownOpacity = opacity * (Number.parseFloat(style.opacity) || 0);
  if (ownOpacity <= 0) {
    return;
  }

  const visible = isRendered(elem);
  if (visible) {
    out.append(...boxToSvg(elem, style, ownOpacity, ctx));
  }

  for (const child of elem.childNodes) {
    if (visible && child instanceof Text) {
      out.append(...textToSvg(child, elem, style, ownOpacity, ctx));
    } else if (child instanceof HTMLElement) {
      collectHtml(child, out, ownOpacity, ctx);
    }
  }
}

/* Render an h5web visualization as an SVG document, as it appears on screen but in
 * light-mode colours. Layers are painted in the order of `renderSnapshot`. WebGL
 * canvases of 2D visualizations are converted to vector paths (lines, glyphs, error
 * bars, contours) over a raster image of anything else (heatmaps); 3D canvases are
 * embedded as raster images. Several visualizations in `root` (e.g. panels) are
 * exported together, each at its position; all panels of a `MultiVisCanvas`, as
 * if it didn't scroll. */
export function renderSvgSnapshot(
  root: HTMLElement,
  options: SvgSnapshotOptions = {},
  withTextLength = false,
): SVGSVGElement {
  const { background = 'white' } = options;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const rasterScale = options.rasterScale ?? Math.min(3, 2 * dpr);

  root.setAttribute(SNAPSHOT_ATTR, '');
  const restoreScrollers = expandScrollers(root); // all panels of a grid
  const origin = root.getBoundingClientRect();
  const { width, height } = origin;
  const svg = createSvgElement('svg', {
    width,
    height,
    viewBox: `0 0 ${fmt(width)} ${fmt(height)}`,
    'font-family': 'sans-serif',
  }) as SVGSVGElement;
  const defs = createSvgElement('defs');
  svg.append(defs);

  const themeColors = getThemeColors(root);
  const prefix = `h5w${Math.random().toString(36).slice(2, 8)}`;
  let idCount = 0;
  const ctx: Context & { root: HTMLElement } = {
    origin,
    root,
    withTextLength,
    rasterScale,
    define: (elem) => {
      const id = `${prefix}-${idCount++}`;
      elem.setAttribute('id', id);
      defs.append(elem);
      return `url(#${id})`;
    },
    mapColor: (color) => {
      if (themeColors.size === 0) {
        return color;
      }
      return themeColors.get(normalizeColor(color)) ?? color;
    },
  };

  if (background !== null) {
    svg.append(createSvgElement('rect', { width, height, fill: background }));
  }

  try {
    for (const canvas of root.querySelectorAll('canvas')) {
      const panels = getCanvasPanels(canvas);
      if (panels && isRendered(canvas)) {
        svg.append(...panelsToSvg(panels, origin, ctx));
      } else if (isRendered(canvas)) {
        const { x, y } = relativeRect(canvas, ctx);
        const group = canvasToSvg(canvas, ctx);
        group.setAttribute('transform', `translate(${fmt(x)} ${fmt(y)})`);
        svg.append(group);
      }
    }

    for (const elem of root.querySelectorAll('svg')) {
      if (!elem.parentElement?.closest('svg') && isRendered(elem)) {
        svg.append(svgToSvg(elem, ctx));
      }
    }

    const html = createSvgElement('g');
    for (const child of root.children) {
      if (child instanceof HTMLElement) {
        collectHtml(child, html, 1, ctx);
      }
    }
    svg.append(html);
  } finally {
    restoreScrollers();
    root.removeAttribute(SNAPSHOT_ATTR);
  }

  if (defs.childElementCount === 0) {
    defs.remove();
  }
  return svg;
}

export function serializeSvg(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

/* Same as `renderSvgSnapshot`, but returns an SVG file */
export async function exportSvgSnapshot(
  root: HTMLElement,
  options?: SvgSnapshotOptions,
): Promise<Blob> {
  const svg = renderSvgSnapshot(root, options);
  return new Blob([serializeSvg(svg)], { type: 'image/svg+xml' });
}

/* Same as `renderSvgSnapshot`, but returns a PDF file of the same size (1 CSS pixel
 * = 0.75 pt), drawn with jsPDF and svg2pdf.js (loaded on first use) */
export async function exportPdfSnapshot(
  root: HTMLElement,
  options?: SvgSnapshotOptions,
): Promise<Blob> {
  const svg = renderSvgSnapshot(root, options, true);
  const { svgToPdf } = await import('./pdf');
  return svgToPdf(svg);
}
