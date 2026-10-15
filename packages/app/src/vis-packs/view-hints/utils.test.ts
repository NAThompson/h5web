import { ScaleType } from '@h5web/shared/vis-models';
import { FiMap } from 'react-icons/fi';
import { describe, expect, it } from 'vitest';

import { ContourMode } from '../core/heatmap/models';
import { type VisDef } from '../models';
import { HintVis } from './models';
import {
  getHeatmapSuggestions,
  getLineDimSuggestions,
  getLineSuggestions,
} from './suggestions';
import { findHintVis, isSurfaceHint, parseViewHint } from './utils';

describe('parseViewHint', () => {
  it('parse known keys', () => {
    const hint = parseViewHint(
      JSON.stringify({
        vis: 'Surface',
        scaleType: 'log',
        colorMap: 'inferno',
        invertColorMap: true,
        domain: [1, null],
        keepRatio: false,
        contours: 12,
        sliceBy: 'generation',
      }),
    );

    expect(hint).toMatchObject({
      vis: HintVis.Surface,
      scaleType: ScaleType.Log,
      colorMap: 'Inferno',
      invertColorMap: true,
      domain: [1, null],
      keepRatio: false,
      contours: 12,
      sliceBy: 'generation',
      overlays: [],
      notes: [],
    });
  });

  it('normalize vis ids and colour map names', () => {
    expect(parseViewHint('{"vis": "complex-surface"}').vis).toBe(
      HintVis.ComplexSurface,
    );
    expect(parseViewHint('{"vis": "COMPLEX_SURFACE"}').vis).toBe(
      HintVis.ComplexSurface,
    );
    expect(parseViewHint('{"colorMap": "rd bu"}').colorMap).toBe('RdBu');
  });

  it('ignore unknown keys silently and invalid values with a note', () => {
    const hint = parseViewHint(
      '{"foo": 1, "vis": "pie", "scaleType": "cubic", "domain": [1], "keepRatio": "yes"}',
    );

    expect(hint.vis).toBeUndefined();
    expect(hint.scaleType).toBeUndefined();
    expect(hint.domain).toBeUndefined();
    expect(hint.keepRatio).toBeUndefined();
    expect(hint.notes).toEqual([
      'ignored invalid "vis"',
      'ignored invalid "scaleType"',
      'ignored invalid "domain"',
      'ignored invalid "keepRatio"',
    ]);
  });

  it('ignore invalid JSON and non-objects', () => {
    expect(parseViewHint('{vis: heatmap')).toEqual({
      overlays: [],
      notes: ['H5WEB_view is not valid JSON'],
    });
    expect(parseViewHint('["heatmap"]').notes).toEqual([
      'H5WEB_view is not a JSON object',
    ]);
  });

  it('parse contours', () => {
    expect(parseViewHint('{"contours": true}').contours).toBe(0);
    expect(parseViewHint('{"contours": false}').contours).toEqual([]);
    expect(parseViewHint('{"contours": [0.1, 1, 10]}').contours).toEqual([
      0.1, 1, 10,
    ]);
    expect(parseViewHint('{"contours": -2}').contours).toBeUndefined();
  });

  it('parse overlays', () => {
    const hint = parseViewHint(
      JSON.stringify({
        overlays: [
          { points: 'population', color: 'fitness', size: 5 },
          {
            ellipse: { mean: 'mean', cov: 'C', scale: 'sigma', nsigma: [1, 2] },
          },
          { curve: 'mean', trail: true, columns: [1, 0], stroke: 'white' },
          { ellipse: { mean: 'mean' } }, // no covariance
          { arrows: 'velocity' }, // unknown kind
          'population',
        ],
      }),
    );

    expect(hint.overlays).toEqual([
      {
        kind: 'points',
        points: 'population',
        color: 'fitness',
        size: 5,
        columns: undefined,
        stroke: undefined,
        fill: undefined,
        z: undefined,
      },
      {
        kind: 'ellipse',
        mean: 'mean',
        cov: 'C',
        scale: 'sigma',
        nsigma: [1, 2],
        columns: undefined,
        stroke: undefined,
      },
      {
        kind: 'curve',
        curve: 'mean',
        trail: true,
        columns: [1, 0],
        stroke: 'white',
      },
    ]);
    expect(hint.notes).toEqual([
      'ignored invalid overlay 4',
      'ignored invalid overlay 5',
      'ignored invalid overlay 6',
    ]);
  });

  it('default to one standard deviation for ellipses', () => {
    const hint = parseViewHint(
      '{"overlays": [{"ellipse": {"mean": "m", "cov": "C"}}]}',
    );
    expect(hint.overlays[0]).toMatchObject({ nsigma: [1] });
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
    const hint = parseViewHint('{"vis": "volume"}');
    expect(findHintVis(hint, [line, heatmap, volume])).toBe(volume);
  });

  it('fall back to heatmap for surfaces when not a parametric surface', () => {
    const hint = parseViewHint('{"vis": "surface"}');
    expect(findHintVis(hint, [line, heatmap])).toBe(heatmap);
    expect(findHintVis(hint, [line, heatmap, surface])).toBe(surface);
  });

  it('ignore unsupported or missing vis', () => {
    expect(
      findHintVis(parseViewHint('{"vis": "volume"}'), [line]),
    ).toBeUndefined();
    expect(findHintVis(parseViewHint('{}'), [line])).toBeUndefined();
  });

  it('find NeXus vis', () => {
    const nxLine = vis('NX Line');
    expect(findHintVis(parseViewHint('{"vis": "line"}'), [nxLine])).toBe(
      nxLine,
    );
  });

  it('tell whether heatmap should open in 3D', () => {
    expect(isSurfaceHint(parseViewHint('{"vis": "surface"}'))).toBe(true);
    expect(isSurfaceHint(parseViewHint('{"vis": "heatmap"}'))).toBe(false);
    expect(isSurfaceHint(parseViewHint('{"vis": "line"}'))).toBeUndefined();
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
        parseViewHint('{"scaleType": "log", "keepRatio": false}'),
        '/f',
        fallbacks,
      ),
    ).toMatchObject({ scaleType: ScaleType.Log, keepRatio: false });

    expect(
      getHeatmapSuggestions(parseViewHint('{}'), '/f', fallbacks),
    ).toMatchObject(fallbacks);
  });

  it('suggest contours', () => {
    expect(
      getHeatmapSuggestions(parseViewHint('{"contours": 5}'), '/f'),
    ).toMatchObject({ contourMode: ContourMode.Auto, contourCount: 5 });

    expect(
      getHeatmapSuggestions(parseViewHint('{"contours": [1, 2]}'), '/f'),
    ).toMatchObject({
      contourMode: ContourMode.Custom,
      contourLevels: { path: '/f', levels: [1, 2] },
    });
  });

  it('suggest height scale of complex surfaces', () => {
    const suggestions = getHeatmapSuggestions(
      parseViewHint('{"vis": "complexSurface", "height": "linear"}'),
      '/f',
    );
    expect(suggestions).toMatchObject({
      surface: true,
      surfaceScaleType: ScaleType.Linear,
    });
  });

  it('use scale type as y scale of lines', () => {
    expect(getLineSuggestions(parseViewHint('{"scaleType": "log"}'))).toEqual({
      xScaleType: undefined,
      yScaleType: ScaleType.Log,
    });
    expect(
      getLineSuggestions(parseViewHint('{"scaleType": "sqrt"}'), {
        yScaleType: ScaleType.SymLog,
      }).yScaleType,
    ).toBe(ScaleType.SymLog);
  });

  it('suggest dimension on x axis and multi-plotted dimension', () => {
    const hint = parseViewHint('{"xDim": 0, "multiDim": 1}');
    expect(getLineDimSuggestions(hint, [100, 8])).toEqual({
      defaultSlice: ['.', 0],
      defaultMultiDim: 1,
    });

    // Too many lines, or the x dimension itself
    expect(
      getLineDimSuggestions(hint, [100, 50]).defaultMultiDim,
    ).toBeUndefined();
    expect(
      getLineDimSuggestions(parseViewHint('{"multiDim": 1}'), [8, 100])
        .defaultMultiDim,
    ).toBeUndefined();
  });
});
