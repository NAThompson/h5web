import { arrayShape, floatType, intType } from '@h5web/shared/hdf5-utils';
import { arrayAttr, dataset, scalarAttr } from '@h5web/shared/mock-utils';
import { ComplexVisType, ScaleType } from '@h5web/shared/vis-models';
import { FiMap } from 'react-icons/fi';
import { describe, expect, it } from 'vitest';

import { ContourMode } from '../core/heatmap/models';
import { type VisDef } from '../models';
import { parseViewHint, toUnicodeScripts } from './attrs';
import { uniqueLegendItems } from './hooks';
import { HintVis } from './models';
import {
  getColorSuggestions,
  getComplexCurveSuggestions,
  getComplexLineSuggestions,
  getHeatmapSuggestions,
  getLineDimSuggestions,
  getLineSuggestions,
} from './suggestions';
import {
  findHintVis,
  formatLabel,
  getHintVisNotes,
  getValueLabel,
  isSurfaceHint,
} from './utils';

type AttrVal = string | number | boolean | number[] | { int: number };

/* Hint of a dataset with these attributes: numbers as `Float64` and integers as `Int8` 1-element
 * arrays (netCDF-4), booleans as h5py booleans */
function hint(attrs: Record<string, AttrVal>, dimNames: string[][] = []) {
  const attributes = Object.entries(attrs).map(([name, val]) => {
    if (typeof val === 'object' && !Array.isArray(val)) {
      return arrayAttr(name, [val.int], { type: intType(true, 8) });
    }
    return typeof val === 'number' || Array.isArray(val)
      ? arrayAttr(name, [val].flat(), { type: floatType(64) })
      : scalarAttr(name, val);
  });
  const dset = dataset('f', arrayShape([3, 4]), floatType(), null, {
    attributes,
  });
  return parseViewHint(
    dset,
    Object.fromEntries(attributes.map(({ name, value }) => [name, value])),
    dimNames,
  );
}

describe('parseViewHint', () => {
  it('leave `H5WEB_color` of points to their source (dataset name or CSS colour)', () => {
    const scatter = hint({ H5WEB_vis: 'scatter', H5WEB_color: 'cluster' });
    expect(scatter.curveColor).toBeUndefined();
    expect(scatter.notes).toEqual([]);
    expect(hint({ H5WEB_color: 'red' }).curveColor).toBe('red'); // line colour, as is in Node
  });

  it('parse known attributes', () => {
    expect(
      hint({
        H5WEB_vis: 'Surface',
        H5WEB_scale: 'log',
        H5WEB_colormap: 'inferno',
        H5WEB_invert_colormap: true, // h5py boolean
        H5WEB_domain: [1, Number.NaN], // NaN: automatic
        H5WEB_keep_ratio: { int: 0 }, // integer boolean
        H5WEB_contour_count: { int: 12 },
        H5WEB_slice_by: 'generation',
        H5WEB_overlays: ' population  ellipse\tmean ',
        H5WEB_ticks: 'pi', // read on dimension scales: ignored silently here
        H5WEB_symlog_threshold: 1e-12, // 1-element array (netCDF-4)
      }),
    ).toMatchObject({
      vis: HintVis.Surface,
      scaleType: ScaleType.Log,
      colorMap: 'Inferno',
      invertColorMap: true,
      domain: [1, null],
      keepRatio: false,
      contours: 12,
      sliceBy: 'generation',
      overlayPaths: ['population', 'ellipse', 'mean'],
      symlogThreshold: 1e-12,
      notes: [],
    });
  });

  it('read scalars stored as scalars or as 1-element arrays, booleans of any integer type', () => {
    const scalars = [
      scalarAttr('H5WEB_z_stretch', 0.5),
      scalarAttr('H5WEB_legend', 1, { type: intType(false, 32) }),
      arrayAttr('H5WEB_keep_ratio', [2n], { type: intType(true, 64) }),
      arrayAttr('long_name', ['ψ_{3,0}\0\0']), // fixed-length string, NUL-padded
    ];
    const dset = dataset('f', arrayShape([3, 4]), floatType(), null, {
      attributes: scalars,
    });
    expect(
      parseViewHint(
        dset,
        Object.fromEntries(scalars.map(({ name, value }) => [name, value])),
      ),
    ).toMatchObject({
      heightScale: 0.5,
      legend: true,
      keepRatio: true,
      title: 'ψ_{3,0}', // sub/superscript markup, rendered by the vis
      notes: [],
    });
  });

  it('parse value transforms and envelopes', () => {
    expect(
      hint({
        H5WEB_value_transform: 'EXP10',
        H5WEB_envelope: 'cummax',
        H5WEB_envelope_direction: 'reverse',
      }),
    ).toMatchObject({
      valueTransform: 'exp10',
      envelope: { type: 'cummax', mode: 'add', reverse: true },
      notes: [],
    });
    expect(
      hint({ H5WEB_envelope: 'min', H5WEB_envelope_mode: 'replace' }),
    ).toMatchObject({
      envelope: undefined,
      notes: ['ignored invalid "H5WEB_envelope"'],
    });
  });

  it('take the title from `H5WEB_title`, else `long_name`', () => {
    expect(hint({ long_name: 'ψ', H5WEB_title: 'Title' }).title).toBe('Title');
    expect(hint({ long_name: 'ψ_{0}' }).title).toBe('ψ_{0}');
    expect(hint({ H5WEB_vis: 'heatmap' }).title).toBeUndefined(); // dataset name
  });

  it('normalize vis ids, colour map names and complex types', () => {
    expect(hint({ H5WEB_vis: 'complex-surface' }).vis).toBe(
      HintVis.ComplexSurface,
    );
    expect(hint({ H5WEB_vis: 'COMPLEX_SURFACE' }).vis).toBe(
      HintVis.ComplexSurface,
    );
    expect(hint({ H5WEB_vis: 'param_surface' }).vis).toBe(HintVis.ParamSurface);
    expect(hint({ H5WEB_colormap: 'rd bu' }).colorMap).toBe('RdBu');
    expect(hint({ H5WEB_complex: 'phase_amplitude' }).complex).toBe(
      'phase-amplitude',
    );
  });

  it('ignore invalid values and wrong types with a note', () => {
    const invalid = hint({
      H5WEB_vis: 'pie',
      H5WEB_scale: 'cubic',
      H5WEB_domain: [1],
      H5WEB_keep_ratio: 'yes', // string, not integer
      H5WEB_legend: 1, // float, not integer
      H5WEB_colormap: { int: 3 }, // integer, not string
      H5WEB_z_stretch: -1,
      H5WEB_symlog_threshold: 0,
    });

    expect(invalid).toMatchObject({
      vis: undefined,
      scaleType: undefined,
      domain: undefined,
      keepRatio: undefined,
      legend: undefined,
      colorMap: undefined,
      heightScale: undefined,
      symlogThreshold: undefined,
    });
    expect(invalid.notes).toEqual([
      'ignored invalid "H5WEB_domain"',
      'ignored invalid "H5WEB_vis"',
      'ignored invalid "H5WEB_scale"',
      'ignored invalid "H5WEB_symlog_threshold"',
      'ignored invalid "H5WEB_colormap"',
      'ignored invalid "H5WEB_legend"',
      'ignored invalid "H5WEB_keep_ratio"',
      'ignored invalid "H5WEB_z_stretch"',
    ]);
  });

  it('parse contours', () => {
    expect(hint({ H5WEB_contour_count: { int: 0 } }).contours).toBe(0); // automatic
    expect(hint({ H5WEB_contour_levels: [0.1, 1, 10] }).contours).toEqual([
      0.1, 1, 10,
    ]);
    expect(
      hint({ H5WEB_contour_levels: [1, 2], H5WEB_contour_count: { int: 5 } })
        .contours,
    ).toEqual([1, 2]); // levels win
    expect(hint({ H5WEB_contour_count: { int: -2 } }).contours).toBeUndefined();
    expect(
      hint({ H5WEB_contour_labels: { int: 1 }, H5WEB_contour_color: 'white' }),
    ).toMatchObject({ contourLabels: true, contourColor: 'white' });
  });

  it('parse emphasized contours and contoured dataset', () => {
    expect(
      hint({
        H5WEB_contour_emphasize: 0, // scalar: one level
        H5WEB_contour_emphasize_width: 3,
        H5WEB_contour_emphasize_color: 'black',
        H5WEB_contour_of: 'psi_re',
      }),
    ).toMatchObject({
      contourEmphasize: [0],
      contourEmphasizeWidth: 3,
      contourEmphasizeColor: 'black',
      contourOf: 'psi_re',
      contours: undefined, // emphasized levels don't turn regular contours on
      notes: [],
    });

    const invalid = hint({
      H5WEB_contour_emphasize: [0, Number.NaN],
      H5WEB_contour_emphasize_width: -1,
    });
    expect(invalid.contourEmphasize).toBeUndefined();
    expect(invalid.contourEmphasizeWidth).toBeUndefined();
    expect(invalid.notes).toHaveLength(2);
  });

  it('parse probe dimension', () => {
    const dimNames = [['kappa', 'κ'], [], []];
    expect(hint({ H5WEB_probe_dim: 'kappa' }, dimNames).probeDim).toBe(0);
    expect(hint({ H5WEB_probe_dim: { int: 2 } }, dimNames).probeDim).toBe(2);
    const unknown = hint({ H5WEB_probe_dim: 'k' }, dimNames);
    expect(unknown.probeDim).toBeUndefined();
    expect(unknown.notes).toEqual(['ignored invalid "H5WEB_probe_dim"']);
  });

  it('parse orthoslices and their initial point', () => {
    const parsed = hint({
      H5WEB_vis: 'Ortho_Slices',
      H5WEB_slice_position: [4, 0, 12],
    });
    expect(parsed).toMatchObject({
      vis: HintVis.Orthoslices,
      slicePosition: [4, 0, 12],
    });
    expect(parsed.notes).toEqual([]);

    for (const position of [
      [1, 2],
      [1, -2, 3],
      [1, 2.5, 3],
    ]) {
      const invalid = hint({ H5WEB_slice_position: position });
      expect(invalid.slicePosition).toBeUndefined();
      expect(invalid.notes).toEqual(['ignored invalid "H5WEB_slice_position"']);
    }
  });

  it('parse projection and its dimension', () => {
    const dimNames = [['time'], [], []];
    expect(
      hint({ H5WEB_projection: 'MAX', H5WEB_projection_dim: 'time' }, dimNames),
    ).toMatchObject({ projection: 'max', projectionDim: 0 });
    expect(
      hint({ H5WEB_projection: 'mean', H5WEB_projection_dim: { int: 1 } }),
    ).toMatchObject({ projection: 'mean', projectionDim: 1 });

    const invalid = hint({ H5WEB_projection: 'median' });
    expect(invalid.projection).toBeUndefined();
    expect(invalid.notes).toEqual(['ignored invalid "H5WEB_projection"']);
  });

  it('parse colours of NaN values and of values beyond the domain', () => {
    expect(
      hint({
        H5WEB_nan_color: '#ddd',
        H5WEB_below_color: 'blue',
        H5WEB_above_color: 'rgb(255, 0, 0)',
      }),
    ).toMatchObject({
      nanColor: '#ddd',
      belowColor: 'blue',
      aboveColor: 'rgb(255, 0, 0)',
    });
    const invalid = hint({ H5WEB_nan_color: { int: 1 } });
    expect(invalid.nanColor).toBeUndefined();
    expect(invalid.notes).toEqual(['ignored invalid "H5WEB_nan_color"']);
  });

  it('parse playback hints', () => {
    expect(
      hint({
        H5WEB_playback_skip_empty: { int: 1 },
        H5WEB_playback_fps: 100, // clamped
        H5WEB_playback_mode: 'Bounce',
      }),
    ).toMatchObject({
      playbackSkipEmpty: true,
      playback: { fps: 60, mode: 'bounce' },
    });
    const invalid = hint({ H5WEB_playback_range: 'all' });
    expect(invalid.playback).toBeUndefined();
    expect(invalid.notes).toEqual(['ignored invalid "H5WEB_playback_range"']);
  });

  it('map dimensions to scale names or indices', () => {
    const dimNames = [['generation'], ['x', 'abscissa']];
    expect(
      hint(
        { H5WEB_x_dim: 'abscissa', H5WEB_multi_dim: 'generation' },
        dimNames,
      ),
    ).toMatchObject({ xDim: 1, multiDim: 0, notes: [] });
    expect(hint({ H5WEB_x_dim: { int: 0 } }).xDim).toBe(0);
    expect(hint({ H5WEB_x_dim: 'time' }, dimNames)).toMatchObject({
      xDim: undefined,
      notes: ['ignored invalid "H5WEB_x_dim"'],
    });
  });

  it('read one or two dimensions of small multiples', () => {
    const dimNames = [['k'], ['p'], ['theta'], ['alpha']];
    expect(
      hint(
        { H5WEB_multiples_dim: 'k p', H5WEB_multiples_columns: { int: 3 } },
        dimNames,
      ),
    ).toMatchObject({ multiplesDims: [0, 1], multiplesColumns: 3, notes: [] });
    expect(
      hint({ H5WEB_multiples_dim: { int: 1 } }, dimNames).multiplesDims,
    ).toEqual([1]);
    expect(
      hint({ H5WEB_multiples_dim: { int: 9 } }, dimNames).multiplesDims,
    ).toBeUndefined(); // beyond the rank
    expect(
      hint({ H5WEB_multiples_dim: 'k p' }, [['k'], ['p']]).multiplesDims,
    ).toBeUndefined(); // no dimension left for the panels
    ['k k', 'k p theta', 'k time'].forEach((val) => {
      expect(hint({ H5WEB_multiples_dim: val }, dimNames)).toMatchObject({
        multiplesDims: undefined,
        notes: ['ignored invalid "H5WEB_multiples_dim"'],
      });
    });
  });

  it('use symmetric domain unless a domain is given', () => {
    expect(hint({ H5WEB_symmetric: { int: 1 } }).domain).toBe('symmetric');
    expect(
      hint({ H5WEB_symmetric: { int: 1 }, H5WEB_domain: [Number.NaN, 5] })
        .domain,
    ).toEqual([null, 5]);
    expect(
      hint({ H5WEB_domain: [Number.NaN, Number.NaN] }).domain,
    ).toBeUndefined();
  });
});

function vis(name: string): VisDef {
  return { name, Icon: FiMap, Container: () => null };
}

describe('findHintVis', () => {
  const line = vis('Line');
  const heatmap = vis('Heatmap');
  const surface = vis('Surface');
  const volume = vis('Volume');

  it('find supported vis by id', () => {
    const parsed = hint({ H5WEB_vis: 'volume' });
    expect(findHintVis(parsed, [line, heatmap, volume])).toBe(volume);
  });

  it('find complex lines for line hints', () => {
    const complexLine = vis('Complex Line');
    expect(
      findHintVis(hint({ H5WEB_vis: 'complex_line' }), [complexLine, heatmap]),
    ).toBe(complexLine);
    expect(
      findHintVis(hint({ H5WEB_vis: 'line' }), [complexLine, heatmap]),
    ).toBe(complexLine);
  });

  it('fall back to heatmap for surfaces when not a parametric surface', () => {
    const parsed = hint({ H5WEB_vis: 'surface' });
    expect(findHintVis(parsed, [line, heatmap])).toBe(heatmap);
    expect(findHintVis(parsed, [line, heatmap, surface])).toBe(surface);
  });

  it('ignore unsupported or missing vis', () => {
    expect(findHintVis(hint({ H5WEB_vis: 'volume' }), [line])).toBeUndefined();
    expect(findHintVis(hint({}), [line])).toBeUndefined();
  });

  it('find NeXus vis', () => {
    const nxLine = vis('NX Line');
    expect(findHintVis(hint({ H5WEB_vis: 'line' }), [nxLine])).toBe(nxLine);
  });

  it('tell whether heatmap should open in 3D', () => {
    expect(isSurfaceHint(hint({ H5WEB_vis: 'surface' }))).toBe(true);
    expect(isSurfaceHint(hint({ H5WEB_vis: 'heatmap' }))).toBe(false);
    expect(isSurfaceHint(hint({ H5WEB_vis: 'line' }))).toBeUndefined();
  });
});

describe('suggestions', () => {
  it('hint takes precedence over NeXus and heuristics', () => {
    const fallbacks = {
      scaleType: ScaleType.SymLog as const,
      keepRatio: true,
    };

    expect(
      getHeatmapSuggestions(
        hint({ H5WEB_scale: 'log', H5WEB_keep_ratio: { int: 0 } }),
        '/f',
        fallbacks,
      ),
    ).toMatchObject({ scaleType: ScaleType.Log, keepRatio: false });

    expect(getHeatmapSuggestions(hint({}), '/f', fallbacks)).toMatchObject(
      fallbacks,
    );
  });

  it('suggest contours', () => {
    expect(
      getHeatmapSuggestions(hint({ H5WEB_contour_count: { int: 5 } }), '/f'),
    ).toMatchObject({ contourMode: ContourMode.Auto, contourCount: 5 });

    expect(
      getHeatmapSuggestions(hint({ H5WEB_contour_levels: [1, 2] }), '/f'),
    ).toMatchObject({
      contourMode: ContourMode.Custom,
      contourLevels: { path: '/f', levels: [1, 2] },
    });

    const emphasis = getHeatmapSuggestions(
      hint({ H5WEB_contour_emphasize: [0, 1] }),
      '/f',
    );
    expect(emphasis.contourEmphasis).toEqual([0, 1]);
    expect(emphasis).not.toHaveProperty('contourMode'); // regular contours stay as they are
  });

  it('suggest domain of complex surfaces', () => {
    expect(
      getHeatmapSuggestions(
        hint({ H5WEB_vis: 'complex_surface', H5WEB_domain: [0, 10] }),
        '/f',
      ),
    ).toMatchObject({ customDomain: [0, 10], surfaceCustomDomain: [0, 10] });
  });

  it('suggest height scale of complex surfaces', () => {
    const suggestions = getHeatmapSuggestions(
      hint({ H5WEB_vis: 'complex_surface', H5WEB_z_scale: 'linear' }),
      '/f',
    );
    expect(suggestions).toMatchObject({
      surface: true,
      surfaceScaleType: ScaleType.Linear,
    });
  });

  it('use scale type as y scale of lines', () => {
    expect(getLineSuggestions(hint({ H5WEB_scale: 'log' }))).toEqual({
      xScaleType: undefined,
      yScaleType: ScaleType.Log,
    });
    expect(
      getLineSuggestions(hint({ H5WEB_scale: 'sqrt' }), {
        yScaleType: ScaleType.SymLog,
      }).yScaleType,
    ).toBe(ScaleType.SymLog);
  });

  it('suggest complex type of lines, and y scale for amplitudes only', () => {
    expect(
      getComplexLineSuggestions(
        hint({ H5WEB_complex: 'phase_unwrapped', H5WEB_scale: 'log' }),
      ),
    ).toEqual({ complexVisType: ComplexVisType.PhaseUnwrapped });
    expect(
      getComplexLineSuggestions(
        hint({ H5WEB_complex: 'phase_amplitude', H5WEB_scale: 'log' }),
      ),
    ).toEqual({
      xScaleType: undefined,
      yScaleType: ScaleType.Log,
      complexVisType: ComplexVisType.Amplitude,
    });
    expect(getComplexLineSuggestions(hint({ H5WEB_scale: 'log' }))).toEqual({
      xScaleType: undefined,
      yScaleType: ScaleType.Log,
      complexVisType: ComplexVisType.Amplitude,
    });
    expect(
      getHeatmapSuggestions(hint({ H5WEB_complex: 'phase_unwrapped' }), '/f')
        .complexVisType,
    ).toBe(ComplexVisType.Phase);
  });

  it('colour complex curves by amplitude only if hinted', () => {
    expect(getComplexCurveSuggestions(hint({}))).toEqual({});
    expect(
      getComplexCurveSuggestions(hint({ H5WEB_complex: 'amplitude' })),
    ).toEqual({ colorBy: ComplexVisType.Amplitude });
    expect(
      getComplexCurveSuggestions(hint({ H5WEB_complex: 'phase_unwrapped' })),
    ).toEqual({ colorBy: ComplexVisType.Phase });
  });

  it('suggest dimension on x axis and multi-plotted dimension', () => {
    const parsed = hint({
      H5WEB_x_dim: { int: 0 },
      H5WEB_multi_dim: { int: 1 },
    });
    expect(getLineDimSuggestions(parsed, [100, 8])).toEqual({
      defaultSlice: ['.', 0],
      defaultMultiDim: 1,
    });

    // Too many lines, or the x dimension itself
    expect(
      getLineDimSuggestions(parsed, [100, 50]).defaultMultiDim,
    ).toBeUndefined();
    expect(
      getLineDimSuggestions(hint({ H5WEB_multi_dim: { int: 1 } }), [8, 100])
        .defaultMultiDim,
    ).toBeUndefined();
  });
});

describe('toUnicodeScripts', () => {
  it('write sub/superscripts with Unicode characters where they exist', () => {
    expect(toUnicodeScripts('ψ_{k,p}(α, θ) r_{12}^{-1} x_{b}')).toBe(
      'ψₖ,ₚ(α, θ) r₁₂⁻¹ xb',
    );
    expect(toUnicodeScripts('plain')).toBe('plain');
  });
});

describe('formatLabel', () => {
  it('split subscripts and superscripts', () => {
    expect(formatLabel('r_{12} = 0')).toEqual([
      { str: 'r' },
      { str: '12', shift: 'sub' },
      { str: ' = 0' },
    ]);
    expect(formatLabel('x^{2}')).toEqual([
      { str: 'x' },
      { str: '2', shift: 'super' },
    ]);
    expect(formatLabel('plain')).toEqual([{ str: 'plain' }]);
  });
});

describe('notes', () => {
  it('note a hinted visualization that is not available', () => {
    const heatmap = vis('Heatmap');
    const volume = hint({ H5WEB_vis: 'volume' });
    expect(getHintVisNotes(volume, findHintVis(volume, [heatmap]))).toEqual([
      '"H5WEB_vis" "volume" is not available for this dataset',
    ]);
    expect(getHintVisNotes(hint({ H5WEB_vis: 'heatmap' }), heatmap)).toEqual(
      [],
    );
    expect(getHintVisNotes(hint({}), undefined)).toEqual([]);
  });
});

describe('value label', () => {
  it('label values with CF `units`, and `long_name` unless it is the title', () => {
    expect(
      getValueLabel({ long_name: 'E_{k}', units: 'hartree' }, 'E_{k}'),
    ).toBe('hartree');
    expect(getValueLabel({ long_name: 'E_{k}', units: 'm^{-1}' }, 'T')).toBe(
      'E_{k} (m^{-1})',
    );
    expect(getValueLabel({ long_name: 'E' }, 'E')).toBeUndefined();
    expect(getValueLabel({ long_name: 'E' }, 'T')).toBe('E');
    expect(getValueLabel({ units: 1 }, undefined)).toBeUndefined();
    expect(getValueLabel({ long_name: 'T', units: 'degC' }, '')).toBe('T (°C)');
    expect(getValueLabel({ long_name: 'r', units: '1' }, '')).toBe('r');
  });
});

describe('colour map and domain', () => {
  it('parse title, legend, auto colour map, symmetric domain', () => {
    expect(
      hint({
        long_name: 'ψ',
        H5WEB_legend: { int: 0 },
        H5WEB_colormap: 'auto',
        H5WEB_symmetric: true,
        H5WEB_center: 1,
      }),
    ).toMatchObject({
      title: 'ψ',
      legend: false,
      colorMap: 'auto',
      domain: 'symmetric',
      center: 1,
      notes: [],
    });
  });

  it('pick diverging map and symmetric domain when data changes sign', () => {
    const auto = hint({ H5WEB_colormap: 'auto' });
    expect(getColorSuggestions(auto, [-1, 3])).toEqual({
      colorMap: 'RdBu',
      customDomain: [-3, 3],
    });
    expect(getColorSuggestions(auto, [1, 3])).toEqual({
      colorMap: 'Viridis',
      customDomain: undefined,
    });
    expect(getColorSuggestions(auto, undefined).colorMap).toBeUndefined(); // until data is known

    // Given domain wins over the symmetric one
    expect(
      getColorSuggestions(
        hint({ H5WEB_colormap: 'auto', H5WEB_domain: [-1, Number.NaN] }),
        [-1, 3],
      ).customDomain,
    ).toEqual([-1, null]);
  });

  it('pick the auto colour map from a fixed domain, the same for every slice', () => {
    const fixed = hint({ H5WEB_colormap: 'auto', H5WEB_domain: [-1, 1] });
    expect(getColorSuggestions(fixed, [0.2, 0.9]).colorMap).toBe('RdBu');
    expect(getColorSuggestions(fixed, undefined).colorMap).toBe('RdBu');
    const positive = hint({ H5WEB_colormap: 'auto', H5WEB_domain: [0, 1] });
    expect(getColorSuggestions(positive, [-1, 1]).colorMap).toBe('Viridis');

    // Automatic end: from the data
    const half = hint({
      H5WEB_colormap: 'auto',
      H5WEB_domain: [Number.NaN, 5],
    });
    expect(getColorSuggestions(half, [-1, 3]).colorMap).toBe('RdBu');
    expect(getColorSuggestions(half, [1, 3]).colorMap).toBe('Viridis');
    expect(getColorSuggestions(half, undefined).colorMap).toBeUndefined();

    // Symmetric: diverging
    const symmetric = hint({
      H5WEB_colormap: 'auto',
      H5WEB_symmetric: { int: 1 },
    });
    expect(getColorSuggestions(symmetric, [1, 3])).toEqual({
      colorMap: 'RdBu',
      customDomain: [-3, 3],
    });
  });

  it('fall back to ±1 around `center` for symmetric domains of data all at `center`', () => {
    expect(
      getColorSuggestions(hint({ H5WEB_symmetric: { int: 1 } }), [0, 0])
        .customDomain,
    ).toEqual([-1, 1]);
    expect(
      getColorSuggestions(hint({ H5WEB_symmetric: { int: 1 } }), [2, 2])
        .customDomain,
    ).toEqual([-2, 2]); // center ± |v − center|
  });

  it('centre symmetric domains on `center`', () => {
    const parsed = hint({ H5WEB_symmetric: { int: 1 }, H5WEB_center: 1 });
    expect(getColorSuggestions(parsed, [0, 4])).toEqual({
      colorMap: undefined,
      customDomain: [-2, 4],
    });
  });

  it('open parametric surface for "surface" when supported, alias "param_surface"', () => {
    const heatmap = vis('Heatmap');
    const surface = vis('Surface');
    expect(
      findHintVis(hint({ H5WEB_vis: 'surface' }), [heatmap, surface]),
    ).toBe(surface);
    expect(
      findHintVis(hint({ H5WEB_vis: 'param_surface' }), [heatmap]),
    ).toBeUndefined();
    expect(findHintVis(hint({ H5WEB_vis: 'complex_heatmap' }), [heatmap])).toBe(
      heatmap,
    );
  });
});

describe('uniqueLegendItems', () => {
  it('show alike legend items once', () => {
    const item = {
      label: 'a',
      color: 'red',
      kind: 'line',
      dash: false,
    } as const;
    expect(
      uniqueLegendItems([item, { ...item }, { ...item, dash: true }, item]),
    ).toEqual([item, { ...item, dash: true }]);
  });
});
