import { ScaleType } from '@h5web/shared/vis-models';
import { Vector2 } from 'three';
import { describe, expect, it } from 'vitest';

import { createScale } from '../utils';
import { setDashDistances } from './lineDash';
import LineGeometry from './lineGeometry';

// Steps of 1 along x, with a NaN gap
const identity = createScale(ScaleType.Linear, {});
const geometry = new LineGeometry({
  abscissas: [0, 1, 2, 3, 4, 5],
  ordinates: [0, 0, Number.NaN, 0, 0, 0],
  abscissaScale: identity,
  ordinateScale: identity,
});
geometry.update();

function getDistances(): number[][] {
  const { instanceDistanceStart: starts, instanceDistanceEnd: ends } =
    geometry.attributes;
  return Array.from({ length: geometry.instanceCount }, (_, i) => [
    starts.getX(i),
    ends.getX(i),
  ]);
}

describe('setDashDistances', () => {
  it('should measure segments in pixels, skipping NaN gaps', () => {
    setDashDistances(geometry, new Vector2(3, 1));
    expect(getDistances()).toEqual([
      [0, 3],
      [3, 3],
      [3, 3],
      [3, 6],
      [6, 9],
    ]);
  });

  it('should wrap starts to the dash period', () => {
    setDashDistances(geometry, new Vector2(6, 1));
    expect(getDistances()).toEqual([
      [0, 6],
      [6, 6],
      [6, 6],
      [6, 12],
      [2, 8],
    ]);
  });
});
