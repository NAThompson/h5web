/* Pure helpers for `gif.ts`, kept free of DOM access for unit testing. */

type Color = [number, number, number];

const MIN_GRAY_COUNT = 16;
const MAX_CACHE_SIZE = 100_000; // colors whose nearest palette color is remembered
const MIN_FREQUENT = 16; // pixels of a color for it to get one of the first colors of the palette
const FREQUENT_COUNT = 176;

/* Delay between frames of a GIF at `fps`, in hundredths of a second (GIF's unit). Browsers slow
 * down delays below 2 (to 10), so frame rates above 50 fps are capped. */
export function getGifDelay(fps: number): number {
  return Math.max(2, Math.round(100 / fps));
}

function toKey(r: number, g: number, b: number): number {
  return r * 65_536 + g * 256 + b;
}

/* Distinct colors of an RGBA image that aren't gray (unlike text, grid and their antialiasing),
 * with how many pixels have them */
export function getColorfulColors(
  rgba: Uint8ClampedArray,
  tolerance = 8,
): Map<number, { color: Color; count: number }> {
  const colors = new Map<number, { color: Color; count: number }>();
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    if (Math.max(r, g, b) - Math.min(r, g, b) > tolerance) {
      const key = toKey(r, g, b);
      const entry = colors.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        colors.set(key, { color: [r, g, b], count: 1 });
      }
    }
  }
  return colors;
}

/* Evenly spaced grays from black to white */
export function getGrays(count: number): Color[] {
  return Array.from({ length: count }, (_, i) => {
    const val = Math.round((i * 255) / (count - 1));
    return [val, val, val];
  });
}

/* Widest channel of colors and its range */
function getWidestChannel(colors: Color[]): { channel: number; range: number } {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const color of colors) {
    for (let c = 0; c < 3; c += 1) {
      min[c] = Math.min(min[c], color[c]);
      max[c] = Math.max(max[c], color[c]);
    }
  }
  const ranges = max.map((val, c) => val - min[c]);
  const range = Math.max(...ranges);
  return { channel: ranges.indexOf(range), range };
}

/* At most `count` colors spread over the given ones (median cut on distinct colors, not weighted
 * by how many pixels have them, so that gradients get evenly spaced colors) */
export function medianCut(colors: Color[], count: number): Color[] {
  const boxes = [colors];
  const widths = [getWidestChannel(colors)];
  while (boxes.length < count) {
    const widest = widths.reduce(
      (best, w, i) => (w.range > widths[best].range ? i : best),
      0,
    );
    const box = boxes[widest];
    if (box.length < 2) {
      break; // all boxes have a single color
    }
    const { channel } = widths[widest];
    box.sort((a, b) => a[channel] - b[channel]);
    const halves = [box.slice(0, box.length / 2), box.slice(box.length / 2)];
    boxes.splice(widest, 1, ...halves);
    widths.splice(widest, 1, ...halves.map(getWidestChannel));
  }
  return boxes
    .filter((box) => box.length > 0)
    .map((box) =>
      [0, 1, 2].map((c) =>
        Math.round(box.reduce((sum, col) => sum + col[c], 0) / box.length),
      ),
    ) as Color[];
}

/* Palette for the frames of a GIF: as many colors as possible for colormaps (e.g. smooth
 * gradients), and grays (incl. black and white) for text and grid, rather than many grays for
 * their antialiasing; the more grays the fewer colors (e.g. curves of a line plot). Colors of
 * many pixels (e.g. color bar, heatmap cells) get most of the palette, rather than colors of a
 * few pixels each (e.g. blended in 3D). */
export function getGifPalette(rgba: Uint8ClampedArray): Color[] {
  const entries = [...getColorfulColors(rgba).values()];
  const frequent = entries.filter(({ count }) => count >= MIN_FREQUENT);
  const others = entries.filter(({ count }) => count < MIN_FREQUENT);
  const colors = medianCut(
    frequent.map(({ color }) => color),
    FREQUENT_COUNT,
  );
  colors.push(
    ...medianCut(
      others.map(({ color }) => color),
      256 - MIN_GRAY_COUNT - colors.length,
    ),
  );
  return [...colors, ...getGrays(256 - colors.length)];
}

/* Index of the nearest palette color of each pixel of an RGBA image (memoized per color) */
export function createPaletteIndexer(
  palette: Color[],
): (rgba: Uint8ClampedArray) => Uint8Array {
  const cache = new Map<number, number>();

  function nearest(r: number, g: number, b: number): number {
    let best = 0;
    let bestDist = Infinity;
    palette.forEach(([pr, pg, pb], i) => {
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    return best;
  }

  return (rgba) => {
    const indices = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < indices.length; i += 1) {
      const [r, g, b] = [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]];
      const key = toKey(r, g, b);
      let index = cache.get(key);
      if (index === undefined) {
        if (cache.size >= MAX_CACHE_SIZE) {
          cache.clear();
        }
        index = nearest(r, g, b);
        cache.set(key, index);
      }
      indices[i] = index;
    }
    return indices;
  };
}
