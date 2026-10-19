import { type Vec2 } from './field';

/* Arrows on a regular grid anchored in world space (so they move with the data when panning),
 * whose step is `spacing` CSS pixels at zoom levels that are powers of 2, i.e. between
 * `spacing / √2` and `spacing · √2` pixels whatever the zoom */
export interface ArrowGrid {
  origin: Vec2; // world position of cell (0, 0)
  step: Vec2; // world
  cols: number;
  rows: number;
}

export function getGridStep(spacing: number, worldPerPx: number): number {
  return spacing * 2 ** Math.round(Math.log2(worldPerPx));
}

export function getArrowGrid(
  center: Vec2,
  worldPerPx: Vec2,
  size: { width: number; height: number },
  spacing: number,
): ArrowGrid {
  const step: Vec2 = [
    getGridStep(spacing, worldPerPx[0]),
    getGridStep(spacing, worldPerPx[1]),
  ];
  const left = center[0] - (size.width / 2) * worldPerPx[0];
  const bottom = center[1] - (size.height / 2) * worldPerPx[1];
  const [i0, j0] = [Math.floor(left / step[0]), Math.floor(bottom / step[1])];
  return {
    origin: [(i0 + 0.5) * step[0], (j0 + 0.5) * step[1]],
    step,
    cols: Math.ceil((size.width * worldPerPx[0]) / step[0]) + 1,
    rows: Math.ceil((size.height * worldPerPx[1]) / step[1]) + 1,
  };
}

/* Most cells a grid can have on a canvas (cf. `getArrowGrid`) */
export function getMaxGridSize(
  size: { width: number; height: number },
  spacing: number,
): [number, number] {
  const min = spacing / Math.SQRT2;
  return [Math.ceil(size.width / min) + 2, Math.ceil(size.height / min) + 2];
}

export interface ArrowShape {
  shaftWidth: number; // CSS pixels
  headWidth: number;
  headLength: number; // at most, and at most 45% of the arrow
}

export const ARROW_SHAPE: ArrowShape = {
  shaftWidth: 1.5,
  headWidth: 6,
  headLength: 7,
};

/*
 * Vertices of the arrow glyph: along the arrow `alongL * L + alongHead * headLength`, across it
 * `sideShaft * shaftWidth + sideHead * headWidth` (L: length of the arrow). Shaft (two
 * triangles) and head (one).
 */
export const GLYPH_VERTICES = [
  [0, 0, -0.5, 0],
  [0, 0, 0.5, 0],
  [1, -1, -0.5, 0],
  [1, -1, 0.5, 0],
  [1, -1, 0, -0.5],
  [1, -1, 0, 0.5],
  [1, 0, 0, 0],
];
export const GLYPH_INDICES = [0, 2, 1, 1, 2, 3, 4, 6, 5];
const OUTLINE_ORDER = [0, 2, 4, 6, 5, 3, 1]; // polygon

/* Offsets (pixels, along and across) of the glyph's vertices for an arrow of length `length`,
 * centred on its position, grown by `outline` pixels (e.g. halo); same as the vertex shader */
export function getGlyphOffsets(
  length: number,
  shape: ArrowShape,
  outline = 0,
): Vec2[] {
  const headLength = Math.min(shape.headLength, 0.45 * length);
  const headWidth = (shape.headWidth * headLength) / shape.headLength;
  return GLYPH_VERTICES.map(([alongL, alongHead, sideShaft, sideHead]) => {
    const side = sideShaft * shape.shaftWidth + sideHead * headWidth;
    const grow = alongL === 0 ? -1 : alongHead === 0 ? 2 : 0;
    return [
      alongL * length + alongHead * headLength - length / 2 + grow * outline,
      side + Math.sign(side) * outline,
    ];
  });
}

/* Outline polygon of an arrow, as offsets from its position */
export function getGlyphPolygon(
  length: number,
  shape: ArrowShape,
  outline = 0,
): Vec2[] {
  const offsets = getGlyphOffsets(length, shape, outline);
  return OUTLINE_ORDER.map((i) => offsets[i]);
}

export const GLSL_GLYPH = /* glsl */ `
  // Pixel offset of a glyph vertex (cf. \`getGlyphOffsets\`)
  vec2 glyphOffset(vec4 glyph, float len, vec3 shape, float outline) {
    float headLength = min(shape.z, 0.45 * len);
    float headWidth = shape.y * headLength / shape.z;
    float side = glyph.z * shape.x + glyph.w * headWidth;
    float grow = glyph.x == 0.0 ? -1.0 : (glyph.y == 0.0 ? 2.0 : 0.0);
    return vec2(
      glyph.x * len + glyph.y * headLength - len / 2.0 + grow * outline,
      side + sign(side) * outline
    );
  }
`;
