import { ParamSurfaceVis, SurfaceRepresentation } from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';

import preview from '../.storybook/preview';
import FillHeight from './decorators/FillHeight';

// Torus (R = 2, r = 0.75) coloured by its Gaussian curvature
const [ROWS, COLS] = [48, 96];
const [R, r] = [2, 0.75];

function grid(fn: (u: number, v: number) => number) {
  return ndarray(
    Float64Array.from({ length: ROWS * COLS }, (_, i) => {
      const u = (2 * Math.PI * Math.floor(i / COLS)) / (ROWS - 1);
      const v = (2 * Math.PI * (i % COLS)) / (COLS - 1);
      return fn(u, v);
    }),
    [ROWS, COLS],
  );
}

const x = grid((u, v) => (R + r * Math.cos(u)) * Math.cos(v));
const y = grid((u, v) => (R + r * Math.cos(u)) * Math.sin(v));
const z = grid((u) => r * Math.sin(u));
const curvature = grid((u) => Math.cos(u) / (r * (R + r * Math.cos(u))));

// Same field, with a hole (`NaN` values)
const withHole = grid((u, v) =>
  Math.abs(u - Math.PI / 2) < 0.5 && Math.abs(v - Math.PI) < 0.6
    ? Number.NaN
    : Math.cos(u) / (r * (R + r * Math.cos(u))),
);

const meta = preview.meta({
  title: 'Visualizations/ParamSurfaceVis',
  component: ParamSurfaceVis,
  decorators: [FillHeight],
  args: { x, y, z, values: curvature },
  argTypes: {
    x: { control: false },
    y: { control: false },
    z: { control: false },
    values: { control: false },
    scaleType: {
      control: { type: 'inline-radio' },
      options: COLOR_SCALE_TYPES,
    },
    representation: {
      control: { type: 'inline-radio' },
      options: Object.values(SurfaceRepresentation),
    },
  },
});

export const Default = meta.story();

export const Labels = meta.story({
  args: {
    title: 'Gaussian curvature of a torus',
    xLabel: 'x (m)',
    yLabel: 'y (m)',
    zLabel: 'z (m)',
  },
});

export const Wireframe = meta.story({
  args: { representation: SurfaceRepresentation.Wireframe },
});

export const SurfaceWithEdges = meta.story({
  args: { representation: SurfaceRepresentation.SurfaceWithEdges },
});

export const Holes = meta.story({
  args: { values: withHole },
});

export const NoShading = meta.story({
  args: { shading: false, colorMap: 'RdBu', invertColorMap: true },
});
