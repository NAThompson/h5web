import { describe, expect, it } from 'vitest';

import { type ResolvedOverlay } from '../../view-hints/overlays';
import {
  getPlaneDomains,
  mergeCoincidentPoints,
  withPlaneStyle,
} from './points';

const STYLE = { fill: 'red', size: 5, halo: false };
const VLINE = {
  kind: 'vline' as const,
  axis: 'x' as const,
  values: [1],
  color: '',
  width: 1,
  dash: false,
};

describe('getPlaneDomains', () => {
  it('include 0 when near and reference lines, padded', () => {
    const { xDomain, yDomain, extent } = getPlaneDomains(
      [{ x: [-3, -0.5], y: [2, -2] }],
      [],
      [VLINE],
    );
    expect(extent).toBe(4);
    expect(xDomain[0]).toBeCloseTo(-3 - 0.32);
    expect(xDomain[1]).toBeCloseTo(1 + 0.32);
    expect(yDomain[0]).toBeCloseTo(-2.32);
    expect(yDomain[1]).toBeCloseTo(2.32);
  });

  it('leave 0 out when far, centre flat axes, fall back to [-1, 1]', () => {
    const { xDomain, yDomain } = getPlaneDomains(
      [{ x: [100, 101], y: [0, 0] }],
      [],
      [],
    );
    expect(xDomain[0]).toBeGreaterThan(99);
    expect(yDomain[0]).toBeCloseTo(-0.58);
    expect(getPlaneDomains([{ x: [], y: [] }], [], [])).toMatchObject({
      xDomain: [-1, 1],
      yDomain: [-1, 1],
    });
  });
});

describe('mergeCoincidentPoints', () => {
  it('draw coincident points once, with their multiplicity', () => {
    const merged = mergeCoincidentPoints(
      {
        x: [0.5, 0.9, 0.5 + 1e-9, 0.5, Number.NaN],
        y: [0, 0.1, 0, 0, 0],
        ...STYLE,
      },
      1e-3,
    );
    expect(merged.x).toEqual([0.5, 0.9, Number.NaN]);
    expect(merged.counts).toEqual([3, 1, 1]);
  });

  it('keep points as they are when none coincide', () => {
    const points = { x: [0, 1], y: [0, 0], ...STYLE };
    expect(mergeCoincidentPoints(points, 1e-3)).toBe(points);
  });
});

describe('withPlaneStyle', () => {
  it('give points the next palette colors, other shapes grey, no halo', () => {
    const overlays = [
      { kind: 'points', points: 'a' },
      { kind: 'circle', circle: 'b' },
      { kind: 'points', points: 'c', color: 'black', halo: true },
      { kind: 'points', points: 'd' },
    ].map((hint) => ({ hint, label: '', inputs: {}, columnOf: {} }));
    const styled = withPlaneStyle(overlays as ResolvedOverlay[], [
      'p0',
      'p1',
      'p2',
    ]);
    expect(styled.map(({ hint }) => [hint.color, hint.halo])).toEqual([
      ['p1', false],
      ['#666', false],
      ['black', true],
      ['p2', false],
    ]);
  });
});
