import { assertDefined } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Attribute,
  type Dataset,
  EntityKind,
  type GroupWithChildren,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import {
  arrayShape,
  floatType,
  intType,
  strType,
} from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  assertMockAttribute,
  dataset,
  group,
  scalar,
  scalarAttr,
  withDimScales,
} from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { findMockEntity } from '../../providers/mock/utils';
import { findStrAttr } from '../core/geometry/utils';
import { parseViewHint } from './attrs';
import { type OverlayHint } from './models';
import {
  buildOverlayShapes,
  buildVolumePoints,
  findLinkedDim,
  getColumnOf,
  getEllipsePoints,
  getIndexFromSelection,
  getLinkedSelection,
  getMissingAxisNotes,
  getOverlayRequests,
  getPixelCentreShift,
  type OverlayContext,
  type OverlayInput,
  type ResolvedOverlay,
  resolveOverlays,
} from './overlays';

function getMockValues(entity: { attributes: Attribute[] }) {
  return Object.fromEntries(
    entity.attributes.map((attr) => {
      assertMockAttribute(attr);
      return [attr.name, attr.value];
    }),
  );
}

function createMockContext(root: GroupWithChildren): OverlayContext {
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
    getAttrValues: async (entity) => getMockValues(entity),
    getValue: async (dset) => (dset as { value?: unknown }).value,
  };
}

/* Attributes from plain values: strings, integers as `Int8` 1-element arrays (netCDF-4) */
function attrs(obj: Record<string, string | number>) {
  return Object.entries(obj).map(([name, value]) =>
    typeof value === 'string'
      ? scalarAttr(name, value)
      : arrayAttr(name, [value], { type: intType(true, 8) }),
  );
}

function arr(
  name: string,
  dims: number[],
  scales?: string[][],
  attributes: Record<string, string | number> = {},
) {
  const dset = dataset(name, arrayShape(dims), floatType(), null, {
    attributes: attrs(attributes),
  });
  return scales ? withDimScales(dset, { scales }) : dset;
}

const G = '/run/generation';

/* CMA-ES-like file: landscape `f` (no generation dimension), per-generation datasets, and
 * overlay objects (`H5WEB_geometry` and style on the overlay itself) */
function setup(
  baseAttrs: Record<string, string | number>,
  extra: ProvidedEntity[] = [],
) {
  const root = group(
    'root.h5',
    [
      group('run', [
        dataset('generation', arrayShape([10]), floatType(), null, {
          attributes: [scalarAttr('NAME', 'generation')],
        }),
        arr('f', [50, 40], undefined, baseAttrs),
        arr('population', [10, 6, 2], [[G], [], []], {
          H5WEB_geometry: 'points',
          H5WEB_color_by: 'fitness',
        }),
        arr('fitness', [10, 6], [[G], []]),
        arr('mean', [10, 2], [[G], []], {
          H5WEB_geometry: 'curve',
          H5WEB_trail: 1,
        }),
        arr('C', [10, 2, 2], [[G], [], []]),
        arr('sigma', [10], [[G]], { H5WEB_geometry: 'points' }),
        group('ellipse', [], {
          attributes: attrs({
            H5WEB_geometry: 'ellipse',
            H5WEB_mean: 'mean',
            H5WEB_cov: 'C',
            H5WEB_sigma: 'sigma',
          }),
        }),
        arr('static_points', [4, 2], undefined, { H5WEB_geometry: 'points' }),
        arr('static_trail', [4, 2], undefined, {
          H5WEB_geometry: 'curve',
          H5WEB_trail: 1,
        }),
        dataset('labels', arrayShape([10]), strType(), null, {
          attributes: attrs({ H5WEB_geometry: 'points' }),
        }),
        ...extra,
      ]),
    ],
    { isRoot: true },
  );

  const base = findMockEntity(root, '/run/f');
  assertDefined(base);
  return {
    root,
    base: base as Dataset<ArrayShape>,
    ctx: createMockContext(root),
    hint: { ...parseViewHint(base, getMockValues(base)), anchor: '/run/f' },
  };
}

/* netCDF-4 dimension without coordinate variable */
function phony(name: string, n: number) {
  return dataset(name, arrayShape([n]), floatType(), null, {
    attributes: [
      scalarAttr(
        'NAME',
        `This is a netCDF dimension but not a netCDF variable. ${n}`,
      ),
    ],
  });
}

describe('resolveOverlays', () => {
  it('link overlays by the generation scale, with an extra slider', async () => {
    const { base, ctx, hint } = setup({
      H5WEB_slice_by: 'generation',
      H5WEB_overlays: 'population ellipse mean',
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
    expect(points.hint).toMatchObject({
      kind: 'points',
      points: '/run/population',
      colorBy: 'fitness',
    });
    expect(points.inputs.points?.linkedDim).toBe(0);
    expect(points.inputs.colorBy?.linkedDim).toBe(0);
    expect(ellipse.hint).toMatchObject({ kind: 'ellipse', nsigma: [1, 2] });
    expect(ellipse.inputs.scale?.linkedDim).toBe(0);
    expect(curve.hint).toMatchObject({ kind: 'curve', trail: true });
    expect(curve.inputs.curve?.linkedDim).toBe(0);
  });

  it('find the link without `H5WEB_slice_by` from the scale of leading dimensions', async () => {
    const { base, ctx, hint } = setup({ H5WEB_overlays: 'population' });
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.link?.scalePath).toBe(G);
  });

  it('link to a dimension of the base dataset with the same scale', async () => {
    const { ctx, hint } = setup({ H5WEB_overlays: 'population' });
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
    const { ctx, hint } = setup({ H5WEB_overlays: 'ridge' }, [
      arr('x', [40]),
      arr('ridge', [40, 2], [['/run/x'], []], { H5WEB_geometry: 'curve' }),
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
      { H5WEB_overlays: '/run/population ./sub/pts static_points' },
      [
        group('sub', [
          arr('pts', [3, 2], undefined, { H5WEB_geometry: 'points' }),
        ]),
      ],
    );
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([]);
    expect(resolved.overlays).toHaveLength(3);
    expect(resolved.overlays[2].inputs.points?.linkedDim).toBeUndefined(); // whole dataset
  });

  it('search bare names past paths that h5wasm gives as unresolved entities', async () => {
    // Paths on an overlay object are relative to its group: `fitness` is searched in `/run/sub`
    // first, then in `/run`
    const { base, ctx, hint } = setup({ H5WEB_overlays: 'sub/pts' }, [
      group('sub', [
        arr('pts', [10, 6, 2], [[G], [], []], {
          H5WEB_geometry: 'points',
          H5WEB_color_by: 'fitness',
        }),
      ]),
    ]);
    const resolved = await resolveOverlays(hint, base, {
      ...ctx,
      getEntity: async (path) =>
        (await ctx.getEntity(path)) ?? {
          name: path.slice(path.lastIndexOf('/') + 1),
          path,
          kind: EntityKind.Unresolved,
          attributes: [],
        },
    });
    expect(resolved.notes).toEqual([]);
    expect(resolved.overlays[0].inputs.colorBy?.dataset.path).toBe(
      '/run/fitness',
    );
  });

  it('share the geometry and style of an overlay between base datasets', async () => {
    const { root, ctx } = setup({}, [
      group('maps', [
        arr('a', [50, 40], undefined, { H5WEB_overlays: '/run/styled' }),
        arr('b', [50, 40], undefined, { H5WEB_overlays: '../styled' }),
      ]),
      arr('styled', [4, 2], undefined, {
        H5WEB_geometry: 'curve',
        H5WEB_color: '#ff2fd6',
        H5WEB_label: 'r_{1} = 0',
        H5WEB_label_mode: 'INLINE',
        H5WEB_dash: 1,
      }),
    ]);

    for (const path of ['/run/maps/a', '/run/maps/b']) {
      const base = findMockEntity(root, path) as Dataset<ArrayShape>;
      const hint = parseViewHint(base, getMockValues(base));
      // eslint-disable-next-line no-await-in-loop -- one base after the other
      const resolved = await resolveOverlays(
        { ...hint, anchor: path },
        base,
        ctx,
      );
      expect(resolved.notes).toEqual([]);
      expect(resolved.overlays[0].hint).toEqual({
        kind: 'curve',
        curve: '/run/styled',
        trail: false,
        color: '#ff2fd6',
        label: 'r_{1} = 0',
        labelMode: 'inline',
        dash: true,
        columnNames: undefined,
        colorBy: undefined,
        width: undefined,
        halo: undefined,
        stroke: undefined,
      });
    }
  });

  it('read texts from scalar string datasets', async () => {
    const { base, ctx, hint } = setup({ H5WEB_overlays: 'label' }, [
      scalar('label', 'r₁₂ = 0', {
        attributes: [
          ...attrs({ H5WEB_geometry: 'text', H5WEB_anchor: 'Top' }),
          arrayAttr('H5WEB_at', [1.5, 0], { type: floatType(64) }),
        ],
      }),
    ]);
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.overlays[0].hint).toMatchObject({
      kind: 'text',
      text: 'r₁₂ = 0',
      at: [1.5, 0],
      anchor: 'top',
    });
  });

  it('skip broken overlays with a note, keep the others', async () => {
    const { base, ctx, hint } = setup(
      {
        H5WEB_overlays:
          'missing labels sigma colored static_trail ellipse no_geometry band bad_ellipse',
      },
      [
        arr('colored', [10, 6, 2], [[G], [], []], {
          H5WEB_geometry: 'points',
          H5WEB_color_by: 'nope',
          H5WEB_width: 'wide', // wrong type: ignored
        }),
        arr('no_geometry', [4, 2]),
        arr('band', [2], undefined, { H5WEB_geometry: 'band' }), // no `H5WEB_axis`
        group('bad_ellipse', [], {
          attributes: attrs({ H5WEB_geometry: 'ellipse', H5WEB_mean: 'mean' }),
        }),
      ],
    );

    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.overlays.map(({ label }) => label)).toEqual([
      'overlay "colored"',
      'overlay "ellipse"',
    ]);
    expect(resolved.notes).toEqual([
      'overlay "missing": not found',
      'overlay "colored": ignored invalid "H5WEB_width"',
      'overlay "no_geometry": no valid "H5WEB_geometry"',
      'overlay "band": needs "H5WEB_axis" (x or y)',
      'overlay "bad_ellipse": needs "H5WEB_mean" and "H5WEB_cov"',
      'overlay "labels": "/run/labels" is not a numeric dataset',
      'overlay "sigma": "/run/sigma" has unexpected shape [10]',
      'overlay "colored": ignored "nope" not found',
      'overlay "static_trail": "/run/static_trail" has no dimension linked to slicing, needed for a trail',
    ]);
  });

  it('link the leading dimension of an overlay by its own `H5WEB_slice_by`', async () => {
    const { base, ctx, hint } = setup({ H5WEB_overlays: 'gen_pts' }, [
      phony('gen_n', 10), // netCDF-4: no scale shared with `generation`
      arr('gen_pts', [10, 3, 2], [['/run/gen_n'], [], []], {
        H5WEB_geometry: 'points',
        H5WEB_slice_by: 'generation',
        H5WEB_z: 'Surface',
      }),
    ]);
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([]);
    expect(resolved.link?.scalePath).toBe(G);
    expect(resolved.overlays[0].inputs.points?.linkedDim).toBe(0);
    expect(resolved.overlays[0].hint).toMatchObject({ z: 'surface' }); // case-insensitive
  });

  it('resolve `H5WEB_slice_by` relative to the object that holds it', async () => {
    const { base, ctx, hint } = setup({ H5WEB_overlays: 'static_points' }, [
      group('sub', [arr('gen2', [10]), arr('signal', [50, 40])]),
    ]);
    const resolved = await resolveOverlays(
      { ...hint, sliceBy: 'gen2', sliceByAnchor: '/run/sub/signal' }, // e.g. NXdata signal
      base,
      ctx,
    );
    expect(resolved.link?.scalePath).toBe('/run/sub/gen2');
  });

  it('note an unknown `H5WEB_slice_by` scale', async () => {
    const { base, ctx, hint } = setup({
      H5WEB_slice_by: 'epoch',
      H5WEB_overlays: 'static_points',
    });
    const resolved = await resolveOverlays(hint, base, ctx);
    expect(resolved.notes).toEqual([
      '"H5WEB_slice_by" dimension scale "epoch" not found',
    ]);
    expect(resolved.overlays).toHaveLength(1);
  });

  it('never link nor name dimensions by netCDF-4 phony scales', async () => {
    const { root, ctx } = setup({}, [
      phony('k', 10),
      phony('pair', 2),
      // Static (N, 2) overlay sharing a phony scale with a sliced dimension of the base
      arr('pts', [10, 2], [['/run/k'], ['/run/pair']], {
        H5WEB_geometry: 'points',
      }),
      arr('named', [10, 2], [['/run/k'], ['/run/pair']], {
        H5WEB_geometry: 'points',
        H5WEB_columns: 'k pair',
      }),
      arr('stack', [10, 50, 40], [['/run/k'], [], []], {
        H5WEB_overlays: 'pts named',
      }),
      arr('stack_sliced', [10, 50, 40], [['/run/k'], [], []], {
        H5WEB_overlays: 'pts',
        H5WEB_slice_by: 'k',
      }),
    ]);

    const stack = findMockEntity(root, '/run/stack') as Dataset<ArrayShape>;
    const resolved = await resolveOverlays(
      { ...parseViewHint(stack, getMockValues(stack)), anchor: stack.path },
      stack,
      ctx,
    );
    expect(resolved.link).toBeUndefined();
    expect(resolved.overlays).toHaveLength(1);
    expect(resolved.overlays[0].inputs.points?.linkedDim).toBeUndefined(); // drawn on every slice
    expect(resolved.notes).toEqual([
      'overlay "named": "H5WEB_columns" "k pair" don\'t name dimensions of "stack"',
    ]);

    const sliced = findMockEntity(
      root,
      '/run/stack_sliced',
    ) as Dataset<ArrayShape>;
    const resolvedSliced = await resolveOverlays(
      { ...parseViewHint(sliced, getMockValues(sliced)), anchor: sliced.path },
      sliced,
      ctx,
    );
    expect(resolvedSliced.link).toBeUndefined();
    expect(resolvedSliced.notes).toEqual([
      '"H5WEB_slice_by" dimension scale "k" not found',
    ]);
  });
});

function curveHint(columnNames?: string[]): OverlayHint {
  return { kind: 'curve', curve: 'c', trail: false, columnNames };
}

describe('getColumnOf', () => {
  const base = arr('psi', [21, 30]) as Dataset<ArrayShape>; // (theta, alpha)
  const dimNames = [['theta'], ['alpha', 'α']];

  it('map columns 0 and 1 to last and second-to-last dimensions by default', () => {
    expect(getColumnOf(curveHint(), base, dimNames)).toEqual({ 1: 0, 0: 1 });
  });

  it('map named columns to dimensions with these scale names', () => {
    expect(getColumnOf(curveHint(['alpha', 'theta']), base, dimNames)).toEqual({
      1: 0,
      0: 1,
    });
    // Columns that don't name a dimension are not drawn (e.g. third coordinate)
    expect(
      getColumnOf(curveHint(['α', 'energy', 'theta']), base, dimNames),
    ).toEqual({ 1: 0, 0: 2 });
    expect(
      getColumnOf(curveHint(['x', 'theta']), base, dimNames),
    ).toBeUndefined();
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
      H5WEB_overlays: 'population mean static_points',
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
  hint: OverlayHint,
  inputs: ResolvedOverlay['inputs'],
  columnOf: ResolvedOverlay['columnOf'] = DEFAULT_COLUMN_OF,
) {
  return {
    hint,
    label: 'overlay',
    inputs,
    columnOf,
  };
}

describe('getPixelCentreShift', () => {
  it('shift by half a pixel when an axis has one evenly spaced value per pixel', () => {
    const shift = getPixelCentreShift([0, 2, 4, 6], 4);
    expect(shift(0)).toBe(1);
    expect(shift(3)).toBe(4);
    expect(shift(-1)).toBe(0); // before the first value
    expect(getPixelCentreShift([3, 2, 1], 3)(2)).toBe(1.5); // descending
  });

  it('leave non-uniform pixel values as is (pixel centres)', () => {
    expect(getPixelCentreShift([0, 1, 2, 4], 4)(2)).toBe(2);
  });

  it('leave bin edges as is and shift indices by half a pixel', () => {
    expect(getPixelCentreShift([0, 1, 2], 2)(1)).toBe(1);
    expect(getPixelCentreShift(undefined, 3)(1)).toBe(1.5);
  });
});

function volumePoints(dims: number[]) {
  return { dataset: arr('pts', dims) };
}

describe('buildVolumePoints', () => {
  const VOLUME_AXES = { x: 2, y: 1 }; // volume `[z, y, x]`
  const COLUMN_OF = { 2: 0, 1: 1 };

  it('draw columns 0, 1 and 2 along x, y and z, colors of matching length', () => {
    const hint: OverlayHint = { kind: 'points', points: 'pts', colorBy: 'c' };
    const colorBy = { dataset: arr('c', [3]) };
    const { points, drawn, notes } = buildVolumePoints(
      [overlay(hint, { points: volumePoints([2, 3]), colorBy }, COLUMN_OF)],
      (_, input) => (input === colorBy ? [1, 2, 3] : [1, 2, 3, 4, 5, 6]),
      undefined,
      VOLUME_AXES,
    );
    expect(points).toEqual([
      { x: [1, 4], y: [2, 5], z: [3, 6], color: 'white', size: 10 },
    ]);
    expect(drawn).toHaveLength(1);
    expect(notes).toEqual([
      'overlay: colors ignored, 3 "H5WEB_color_by" values for 2 points',
    ]);
  });

  it('note overlays that cannot be drawn, out of the legend', () => {
    const { points, drawn, notes } = buildVolumePoints(
      [
        overlay(
          { kind: 'points', points: 'pts' },
          { points: volumePoints([2, 2]) },
          COLUMN_OF,
        ),
        overlay(
          { kind: 'points', points: 'pts', z: 'value' },
          { points: volumePoints([2, 3]) },
          COLUMN_OF,
        ),
        overlay({ kind: 'curve', curve: 'pts', trail: false }, {}, COLUMN_OF),
      ],
      () => [1, 2, 3, 4],
      undefined,
      VOLUME_AXES,
    );
    expect(points).toEqual([]);
    expect(drawn).toEqual([]);
    expect(notes).toEqual([
      'overlay: not drawn, 3 columns expected, got 2',
      'overlay: not drawn, "H5WEB_z" "value" has no meaning in 3D',
      'overlay: not drawn in 3D (points only)',
    ]);
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
      [overlay({ kind: 'curve', curve: 'mean', trail: true }, { curve: mean })],
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
        halo: true,
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
      [
        overlay(
          { kind: 'curve', curve: 'meanT', trail: true },
          { curve: meanT },
        ),
      ],
      () => values,
      2,
      AXES,
    );
    expect(shapes.lines[0]).toMatchObject({ x: [0, 1, 2], y: [0, 10, 20] });
  });

  it('draw whole curve when not a trail, swapping columns if transposed', () => {
    const shapes = buildOverlayShapes(
      [
        overlay(
          { kind: 'curve', curve: 'mean', trail: false },
          { curve: mean },
        ),
      ],
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
      [
        overlay(
          { kind: 'points', points: 'pts', colorBy: 'c' },
          { points: pts, colorBy },
        ),
      ],
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

    // Named columns: points sit on the surface unless `H5WEB_z` says otherwise
    const named = buildOverlayShapes(
      [
        overlay(
          { kind: 'points', points: 'pts', columnNames: ['a', 'b', 'c'] },
          { points: pts },
        ),
      ],
      () => [1, 2, 3, 4, 5, 6],
      undefined,
      AXES,
    );
    expect(named.points[0].z).toBeUndefined();
  });

  it('project ellipses on chosen columns of higher-dimensional Gaussians', () => {
    const m = { dataset: arr('m', [3]) };
    const c = { dataset: arr('C', [3, 3]) };
    const shapes = buildOverlayShapes(
      [
        overlay(
          { kind: 'ellipse', mean: 'm', cov: 'C', nsigma: [1] },
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
      [
        overlay(
          { kind: 'points', points: 'pts' },
          { points: pts },
          { 0: 0, 1: 1 },
        ),
      ],
      () => [0.5, 2],
      undefined,
      AXES,
    );
    expect(shapes.points[0]).toMatchObject({ x: [2], y: [0.5] });

    // Single point stored as `(2,)`
    const point = { dataset: arr('point', [2]) };
    const single = buildOverlayShapes(
      [overlay({ kind: 'points', points: 'point' }, { points: point })],
      () => [1, 2],
      undefined,
      AXES,
    );
    expect(single.points[0]).toMatchObject({ x: [1], y: [2] });
  });

  it('note overlays whose columns do not name a dimension shown on an axis', () => {
    const pts = overlay({ kind: 'points', points: 'pts' }, {}, { 2: 0, 3: 1 });
    expect(getMissingAxisNotes([pts], { x: 3, y: 2 }, [])).toEqual([]);
    expect(
      getMissingAxisNotes([pts], { x: 3, y: 1 }, [undefined, 'R (bohr)']),
    ).toEqual([
      'overlay: not drawn, "H5WEB_columns" don\'t name the y axis (R (bohr))',
    ]);
    expect(getMissingAxisNotes([pts], { x: 0, y: 1 }, [])).toEqual([
      'overlay: not drawn, "H5WEB_columns" don\'t name the x axis (D0) or y axis (D1)',
    ]);
  });

  it('place texts and inline labels, in axis values', () => {
    const edge = { dataset: arr('edge', [2, 2]) };
    const shapes = buildOverlayShapes(
      [
        overlay(
          { kind: 'text', text: 'r₁₂ = 0', at: [1.5, 0], anchor: 'top' },
          {},
        ),
        overlay(
          {
            kind: 'curve',
            curve: 'edge',
            trail: false,
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
      {
        x: 1.5,
        y: 0,
        text: 'r₁₂ = 0',
        anchor: 'top',
        color: 'white',
        halo: true,
      },
      {
        x: 0,
        y: 1.5, // middle of the curve
        text: 'e–n',
        anchor: 'right',
        color: '#000',
        halo: true,
        isInline: true,
      },
    ]);
    expect(shapes.lines[0]).toMatchObject({ stroke: '#000', dash: true });
  });

  it('count columns once sliced, when the linked dimension is last', () => {
    const pts = { dataset: arr('pts', [3, 2, 10]), linkedDim: 2 }; // (N, d, G)
    const shapes = buildOverlayShapes(
      [overlay({ kind: 'points', points: 'pts' }, { points: pts })],
      () => [1, 2, 3, 4, 5, 6], // slice (3, 2)
      4,
      AXES,
    );
    expect(shapes.points[0]).toMatchObject({ x: [1, 3, 5], y: [2, 4, 6] });
  });

  it('draw halos unless disabled', () => {
    const edge = { dataset: arr('edge', [2, 2]) };
    const shapes = buildOverlayShapes(
      [
        overlay(
          { kind: 'curve', curve: 'edge', trail: false, halo: false },
          { curve: edge },
        ),
        overlay({ kind: 'points', points: 'edge' }, { points: edge }),
      ],
      () => [0, 0, 0, 3],
      undefined,
      AXES,
    );
    expect(shapes.lines[0].halo).toBe(false);
    expect(shapes.points[0].halo).toBe(true);
  });

  it('skip overlays whose values are not available yet', () => {
    const shapes = buildOverlayShapes(
      [overlay({ kind: 'curve', curve: 'mean', trail: true }, { curve: mean })],
      () => undefined,
      3,
      AXES,
    );
    expect(shapes).toEqual({ points: [], lines: [], texts: [] });
  });
});
