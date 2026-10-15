import { assertDefined } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type GroupWithChildren,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { arrayShape, floatType, strType } from '@h5web/shared/hdf5-utils';
import {
  assertMockAttribute,
  dataset,
  group,
  scalarAttr,
  withDimScales,
} from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { findMockEntity } from '../../providers/mock/utils';
import { findStrAttr, type GeometryContext } from '../core/geometry/utils';
import {
  buildOverlayShapes,
  findLinkedDim,
  getColumnOf,
  getEllipsePoints,
  getIndexFromSelection,
  getLinkedSelection,
  getOverlayRequests,
  getPixelCentreShift,
  type OverlayInput,
  type ResolvedOverlay,
  resolveOverlays,
} from './overlays';
import { parseViewHint } from './utils';

function createMockContext(root: GroupWithChildren): GeometryContext {
  return {
    getEntity: async (path) => {
      try {
        return findMockEntity(root, path);
      } catch {
        return undefined;
      }
    },
    getStrAttr: async (entity, name) => {
      const attr = findStrAttr(entity, name);
      if (!attr) {
        return undefined;
      }
      assertMockAttribute(attr);
      return typeof attr.value === 'string' ? attr.value : undefined;
    },
    getDimensionScales: async (dset) =>
      (dset as { dimScales?: string[][] }).dimScales ?? [],
  };
}

function arr(name: string, dims: number[], scales?: string[][]) {
  const dset = dataset(name, arrayShape(dims), floatType(), null);
  return scales ? withDimScales(dset, { scales }) : dset;
}

const G = '/run/generation';

/* CMA-ES-like file: landscape `f` (no generation dimension) and per-generation datasets */
function setup(hint: unknown, extra: ProvidedEntity[] = []) {
  const root = group(
    'root.h5',
    [
      group('run', [
        dataset('generation', arrayShape([10]), floatType(), null, {
          attributes: [scalarAttr('NAME', 'generation')],
        }),
        dataset('f', arrayShape([50, 40]), floatType(), null, {
          attributes: [scalarAttr('H5WEB_view', JSON.stringify(hint))],
        }),
        arr('population', [10, 6, 2], [[G], [], []]),
        arr('fitness', [10, 6], [[G], []]),
        arr('mean', [10, 2], [[G], []]),
        arr('C', [10, 2, 2], [[G], [], []]),
        arr('sigma', [10], [[G]]),
        arr('static_points', [4, 2]),
        dataset('labels', arrayShape([10]), strType(), null),
        ...extra,
      ]),
    ],
    { isRoot: true },
  );

  const base = findMockEntity(root, '/run/f');
  assertDefined(base);
  return {
    base: base as Dataset<ArrayShape>,
    ctx: createMockContext(root),
    hint: { ...parseViewHint(JSON.stringify(hint)), anchor: '/run/f' },
  };
}

describe('resolveOverlays', () => {
  it('link overlays by the generation scale, with an extra slider', async () => {
    const { base, ctx, hint } = setup({
      sliceBy: 'generation',
      overlays: [
        { points: 'population', colorBy: 'fitness' },
        { ellipse: { mean: 'mean', cov: 'C', scale: 'sigma' } },
        { curve: 'mean', trail: true },
      ],
    });

    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([]);
    expect(resolved.link).toEqual({
      scalePath: G,
      label: 'generation',
      length: 10,
      baseDim: undefined, // `f` has no generation dimension
    });

    const [points, ellipse, curve] = resolved.overlays;
    expect(points.inputs.points?.linkedDim).toBe(0);
    expect(points.inputs.colorBy?.linkedDim).toBe(0);
    expect(ellipse.inputs.scale?.linkedDim).toBe(0);
    expect(curve.inputs.curve?.linkedDim).toBe(0);
  });

  it('find the link without `sliceBy` from the scale of leading dimensions', async () => {
    const { base, ctx, hint } = setup({ overlays: [{ points: 'population' }] });
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.link?.scalePath).toBe(G);
  });

  it('link to a dimension of the base dataset with the same scale', async () => {
    const { ctx, hint } = setup({ overlays: [{ points: 'population' }] });
    const landscapes = arr('landscapes', [10, 50, 40], [[G], [], []]);
    const resolved = await resolveOverlays(
      hint,
      { ...landscapes, path: '/run/landscapes' },
      { ...ctx, getDimensionScales: async () => [[G], [], []] },
    );
    expect(resolved.link?.baseDim).toBe(0);
  });

  it('draw a curve along an axis of the base whole, not linked by that axis', async () => {
    // Ridge (X, 2) with the base's own x scale attached to its first dimension
    const { ctx, hint } = setup({ overlays: [{ curve: 'ridge' }] }, [
      arr('x', [40]),
      arr('ridge', [40, 2], [['/run/x'], []]),
    ]);
    const base = arr('f', [50, 40], [[], ['/run/x']]) as Dataset<ArrayShape>;
    const resolved = await resolveOverlays(
      hint,
      { ...base, path: '/run/f' },
      {
        ...ctx,
        getDimensionScales: async (dset) =>
          dset.name === 'f'
            ? [[], ['/run/x']]
            : ((dset as { dimScales?: string[][] }).dimScales ?? []),
      },
    );

    expect(resolved.notes).toEqual([]);
    expect(resolved.link).toBeUndefined();
    expect(resolved.overlays[0].inputs.curve?.linkedDim).toBeUndefined();
  });

  it('resolve absolute, relative and ancestor paths', async () => {
    const { base, ctx, hint } = setup(
      {
        overlays: [
          { points: '/run/population' },
          { points: './sub/pts' },
          { points: 'static_points' },
        ],
      },
      [group('sub', [arr('pts', [3, 2])])],
    );
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([]);
    expect(resolved.overlays).toHaveLength(3);
    expect(resolved.overlays[2].inputs.points?.linkedDim).toBeUndefined(); // whole dataset
  });

  it('skip broken overlays with a note, keep the others', async () => {
    const { base, ctx, hint } = setup({
      overlays: [
        { points: 'missing' },
        { points: 'labels' },
        { points: 'sigma' }, // 1D
        { points: 'population', colorBy: 'nope' },
        { curve: 'static_points', trail: true }, // nothing to trail along
        { ellipse: { mean: 'mean', cov: 'C' } },
      ],
    });

    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.overlays.map(({ label }) => label)).toEqual([
      'overlay 4 (points)',
      'overlay 6 (ellipse)',
    ]);
    expect(resolved.notes).toEqual([
      'overlay 1 (points): "missing" not found',
      'overlay 2 (points): "labels" is not a numeric dataset',
      'overlay 3 (points): "sigma" has unexpected shape [10]',
      'overlay 4 (points): ignored "nope" not found',
      'overlay 5 (curve): "static_points" has no dimension linked to slicing, needed for a trail',
    ]);
  });

  it('note an unknown `sliceBy` scale', async () => {
    const { base, ctx, hint } = setup({
      sliceBy: 'epoch',
      overlays: [{ points: 'static_points' }],
    });
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([
      '"sliceBy" dimension scale "epoch" not found',
    ]);
    expect(resolved.overlays).toHaveLength(1);
  });
});

describe('getColumnOf', () => {
  const base = arr('psi', [21, 30]) as Dataset<ArrayShape>; // (theta, alpha)
  const dimNames = [['theta'], ['alpha', 'α']];

  it('map columns 0 and 1 to last and second-to-last dimensions by default', () => {
    const [hint] = parseViewHint('{"overlays": [{"curve": "c"}]}').overlays;
    expect(getColumnOf(hint, base, dimNames)).toEqual({ 1: 0, 0: 1 });
  });

  it('map named columns to dimensions with these scale names', () => {
    const [hint] = parseViewHint(
      '{"overlays": [{"curve": "c", "columns": ["alpha", "theta"]}]}',
    ).overlays;
    expect(getColumnOf(hint, base, dimNames)).toEqual({ 1: 0, 0: 1 });

    const [unknown] = parseViewHint(
      '{"overlays": [{"curve": "c", "columns": ["x", "theta"]}]}',
    ).overlays;
    expect(getColumnOf(unknown, base, dimNames)).toBeUndefined();
  });
});

describe('linked slicing', () => {
  const link = { scalePath: G, label: 'generation', length: 10 };

  it('find linked dimension by scale, or first dimension of matching length', () => {
    expect(findLinkedDim([6, 10], [[], [G]], link)).toBe(1);
    expect(findLinkedDim([10, 2], null, link)).toBe(0); // provider can't tell
    expect(findLinkedDim([10, 2], [[], []], link)).toBe(0); // no scales at all
    expect(findLinkedDim([10, 2], [['/other'], []], link)).toBeUndefined();
    expect(findLinkedDim([10, 2], null, undefined)).toBeUndefined();
  });

  it('select the slice at the linked index', () => {
    const input: OverlayInput = {
      dataset: arr('pop', [10, 6, 2]),
      linkedDim: 0,
    };
    expect(getLinkedSelection(input, 3)).toBe('3,:,:');
    expect(getLinkedSelection({ ...input, linkedDim: 1 }, 3)).toBe(':,3,:');
    expect(
      getLinkedSelection({ ...input, linkedDim: undefined }, 3),
    ).toBeUndefined();
  });

  it('read index of linked dimension from slice selection', () => {
    expect(getIndexFromSelection('4,:,:', 0)).toBe(4);
    expect(getIndexFromSelection(':,:,7', 2)).toBe(7);
    expect(getIndexFromSelection(':,:', 0)).toBeUndefined();
    expect(getIndexFromSelection(undefined, 0)).toBeUndefined();
  });

  it('fetch slices at the linked index and trails whole', async () => {
    const { base, ctx, hint } = setup({
      overlays: [
        { points: 'population', colorBy: 'fitness' },
        { curve: 'mean', trail: true },
        { points: 'static_points' },
      ],
    });
    const resolved = await resolveOverlays(hint, base, ctx);

    const requests = getOverlayRequests(resolved, 4).map(
      ({ dataset: d, selection }) => `${d.name}[${selection ?? ''}]`,
    );
    expect(requests).toEqual([
      'population[4,:,:]',
      'fitness[4,:]',
      'mean[]',
      'static_points[]',
    ]);

    // No index (e.g. linked dimension mapped to an axis): only unlinked datasets
    expect(getOverlayRequests(resolved, undefined)).toHaveLength(1);
  });
});

/* Base dataset of rank 2: x shows dimension 1, y dimension 0 (unless transposed) */
const AXES = { x: 1, y: 0 };
const DEFAULT_COLUMN_OF = { 1: 0, 0: 1 };

function overlay(
  hint: unknown,
  inputs: ResolvedOverlay['inputs'],
  columnOf: ResolvedOverlay['columnOf'] = DEFAULT_COLUMN_OF,
) {
  return {
    hint: parseViewHint(JSON.stringify({ overlays: [hint] })).overlays[0],
    label: 'overlay',
    inputs,
    columnOf,
  };
}

describe('getPixelCentreShift', () => {
  it('shift by half a pixel when an axis has one value per pixel', () => {
    const shift = getPixelCentreShift([0, 1, 2, 4], 4);
    expect(shift(0)).toBe(0.5);
    expect(shift(2)).toBe(3); // pixel [2, 4]
    expect(shift(4)).toBe(5); // last pixel: width of the previous one
    expect(shift(-1)).toBe(-0.5); // before the first value
    expect(getPixelCentreShift([3, 2, 1], 3)(2)).toBe(1.5); // descending
  });

  it('leave bin edges as is and shift indices by half a pixel', () => {
    expect(getPixelCentreShift([0, 1, 2], 2)(1)).toBe(1);
    expect(getPixelCentreShift(undefined, 3)(1)).toBe(1.5);
  });
});

describe('shapes', () => {
  it('compute ellipse of a 2D Gaussian along its principal axes', () => {
    // Covariance with eigenvalues 4 and 1 along the diagonals
    const cov: [[number, number], [number, number]] = [
      [2.5, 1.5],
      [1.5, 2.5],
    ];
    const { x, y } = getEllipsePoints([1, 2], cov, 1, 1, 4);
    expect(x[0]).toBeCloseTo(1 + 2 * Math.SQRT1_2); // major semi-axis 2 at 45°
    expect(y[0]).toBeCloseTo(2 + 2 * Math.SQRT1_2);
    expect(x[1]).toBeCloseTo(1 - Math.SQRT1_2); // minor semi-axis 1 at 135°
    expect(y[1]).toBeCloseTo(2 + Math.SQRT1_2);

    // σ = 2 and 2 standard deviations: semi-axes scaled by 4
    const scaled = getEllipsePoints(
      [0, 0],
      [
        [1, 0],
        [0, 1],
      ],
      2,
      2,
      4,
    );
    expect(scaled.x[0]).toBeCloseTo(4);
  });

  const mean = { dataset: arr('mean', [10, 2]), linkedDim: 0 };
  // Mean at generation g: (g, 10 g)
  const meanValues = Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0 ? i / 2 : (10 * (i - 1)) / 2,
  );

  it('draw trail up to the linked index', () => {
    const shapes = buildOverlayShapes(
      [overlay({ curve: 'mean', trail: true }, { curve: mean })],
      () => meanValues,
      3,
      AXES,
    );
    expect(shapes.lines).toEqual([
      {
        x: [0, 1, 2, 3],
        y: [0, 10, 20, 30],
        stroke: 'white',
        width: 1.5,
        dash: false,
        label: undefined,
        head: true,
      },
    ]);
  });

  it('draw trail along a linked second dimension', () => {
    // Mean stored as (2, G): row 0 holds x, row 1 holds y
    const meanT = { dataset: arr('meanT', [2, 10]), linkedDim: 1 };
    const values = [
      ...Array.from({ length: 10 }, (_, g) => g),
      ...Array.from({ length: 10 }, (_, g) => 10 * g),
    ];
    const shapes = buildOverlayShapes(
      [overlay({ curve: 'meanT', trail: true }, { curve: meanT })],
      () => values,
      2,
      AXES,
    );
    expect(shapes.lines[0]).toMatchObject({ x: [0, 1, 2], y: [0, 10, 20] });
  });

  it('draw whole curve when not a trail, swapping columns if transposed', () => {
    const shapes = buildOverlayShapes(
      [overlay({ curve: 'mean' }, { curve: mean })],
      () => meanValues.slice(0, 4),
      undefined,
      { x: 0, y: 1 }, // transposed
    );
    expect(shapes.lines[0]).toMatchObject({ x: [0, 10], y: [0, 1] });
  });

  it('draw points coloured by values, with z from a third column', () => {
    const pts = { dataset: arr('pts', [2, 3]) };
    const colorBy = { dataset: arr('c', [2]) };
    const shapes = buildOverlayShapes(
      [overlay({ points: 'pts', colorBy: 'c' }, { points: pts, colorBy })],
      (_, input) => (input === pts ? [1, 2, 3, 4, 5, 6] : [7, 8]),
      undefined,
      AXES,
    );
    expect(shapes.points[0]).toMatchObject({
      x: [1, 4],
      y: [2, 5],
      z: [3, 6],
      values: [7, 8],
    });
  });

  it('project ellipses on chosen columns of higher-dimensional Gaussians', () => {
    const m = { dataset: arr('m', [3]) };
    const c = { dataset: arr('C', [3, 3]) };
    const shapes = buildOverlayShapes(
      [
        overlay(
          { ellipse: { mean: 'm', cov: 'C' }, columns: [0, 2] },
          { mean: m, cov: c },
          { 1: 0, 0: 2 },
        ),
      ],
      (_, input) => (input === m ? [1, 2, 3] : [4, 0, 0, 0, 1, 0, 0, 0, 9]), // diag(4, 1, 9)
      undefined,
      AXES,
    );
    const [ellipse] = shapes.lines;
    expect(ellipse.x[0]).toBeCloseTo(1); // major axis along 3rd coordinate (σ = 3)
    expect(ellipse.y[0]).toBeCloseTo(6);
  });

  it('map named columns to the axes showing these dimensions', () => {
    // Rows are [theta, alpha] for a field (theta, alpha): theta on y, alpha on x
    const pts = { dataset: arr('pts', [1, 2]) };
    const shapes = buildOverlayShapes(
      [overlay({ points: 'pts' }, { points: pts }, { 0: 0, 1: 1 })],
      () => [0.5, 2],
      undefined,
      AXES,
    );
    expect(shapes.points[0]).toMatchObject({ x: [2], y: [0.5] });

    // Single point stored as `(2,)`
    const point = { dataset: arr('point', [2]) };
    const single = buildOverlayShapes(
      [overlay({ points: 'point' }, { points: point })],
      () => [1, 2],
      undefined,
      AXES,
    );
    expect(single.points[0]).toMatchObject({ x: [1], y: [2] });
  });

  it('place texts and inline labels, in axis values', () => {
    const edge = { dataset: arr('edge', [2, 2]) };
    const shapes = buildOverlayShapes(
      [
        overlay({ text: 'r₁₂ = 0', at: [1.5, 0], anchor: 'top' }, {}),
        overlay(
          {
            curve: 'edge',
            label: 'e–n',
            labelMode: 'inline',
            color: '#000',
            dash: true,
          },
          { curve: edge },
        ),
      ],
      () => [0, 0, 0, 3],
      undefined,
      AXES,
    );
    expect(shapes.texts).toEqual([
      { x: 1.5, y: 0, text: 'r₁₂ = 0', anchor: 'top', color: 'white' },
      { x: 0, y: 3, text: 'e–n', anchor: 'right', color: '#000' },
    ]);
    expect(shapes.lines[0]).toMatchObject({ stroke: '#000', dash: true });
  });

  it('count columns once sliced, when the linked dimension is last', () => {
    const pts = { dataset: arr('pts', [3, 2, 10]), linkedDim: 2 }; // (N, d, G)
    const shapes = buildOverlayShapes(
      [overlay({ points: 'pts' }, { points: pts })],
      () => [1, 2, 3, 4, 5, 6], // slice (3, 2)
      4,
      AXES,
    );
    expect(shapes.points[0]).toMatchObject({ x: [1, 3, 5], y: [2, 4, 6] });
  });

  it('skip overlays whose values are not available yet', () => {
    const shapes = buildOverlayShapes(
      [overlay({ curve: 'mean', trail: true }, { curve: mean })],
      () => undefined,
      3,
      AXES,
    );
    expect(shapes).toEqual({ points: [], lines: [], texts: [] });
  });
});
