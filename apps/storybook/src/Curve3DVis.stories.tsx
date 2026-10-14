import { Curve3DVis, CurveType } from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';

import preview from '../.storybook/preview';
import FillHeight from './decorators/FillHeight';

// Lissajous knot (3, 5, 7), coloured by its speed
const SAMPLES = 1000;
const t = Float64Array.from(
  { length: SAMPLES },
  (_, i) => (2 * Math.PI * i) / (SAMPLES - 1),
);
const x = t.map((val) => Math.cos(3 * val + 0.7));
const y = t.map((val) => Math.cos(5 * val + 1));
const z = t.map((val) => Math.cos(7 * val));
const speed = t.map((val) =>
  Math.hypot(
    3 * Math.sin(3 * val + 0.7),
    5 * Math.sin(5 * val + 1),
    7 * Math.sin(7 * val),
  ),
);

// Conical helix with a gap (`NaN` coordinates)
const helixT = Float64Array.from({ length: 300 }, (_, i) => i / 20);
const helixX = helixT.map((val, i) =>
  i > 120 && i < 140 ? Number.NaN : val * Math.cos(val),
);
const helixY = helixT.map((val) => val * Math.sin(val));

const meta = preview.meta({
  title: 'Visualizations/Curve3DVis',
  component: Curve3DVis,
  decorators: [FillHeight],
  args: { x, y, z, values: speed },
  argTypes: {
    x: { control: false },
    y: { control: false },
    z: { control: false },
    values: { control: false },
    scaleType: {
      control: { type: 'inline-radio' },
      options: COLOR_SCALE_TYPES,
    },
    curveType: {
      control: { type: 'inline-radio' },
      options: Object.values(CurveType),
    },
    lineWidth: { control: { type: 'range', min: 1, max: 10, step: 1 } },
  },
});

export const Default = meta.story();

export const Labels = meta.story({
  args: {
    title: 'Lissajous knot',
    xLabel: 'x (m)',
    yLabel: 'y (m)',
    zLabel: 'z (m)',
  },
});

export const Points = meta.story({
  args: { curveType: CurveType.LineAndGlyphs, pointSize: 4, lineWidth: 1 },
});

export const ColouredByIndex = meta.story({
  name: 'Coloured by index, with gap',
  args: {
    x: helixX,
    y: helixY,
    z: helixT,
    values: undefined,
    colorMap: 'Turbo',
  },
});

export const Planar = meta.story({
  args: { z: undefined, keepRatio: false },
});
