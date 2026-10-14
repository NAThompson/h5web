import {
  getLabelAnchors,
  marchingSquaresSteps,
} from '../contours/marchingSquares';
import {
  type IsosurfaceGeometry,
  marchingCubesSteps,
} from '../volume/marchingCubes';
import {
  type AxisCoords,
  type ContourResult,
  type LabelOptions,
  type ScaleTypeParam,
} from './models';

/* Contours for several levels, yielding overall progress */
export function* contoursSteps(
  values: ArrayLike<number>,
  shape: [number, number],
  levels: number[],
  scaleType: ScaleTypeParam,
  labels: LabelOptions | undefined,
): Generator<number, ContourResult[]> {
  const results: ContourResult[] = [];

  for (const [i, level] of levels.entries()) {
    const gen = marchingSquaresSteps(values, shape, level, { scaleType });
    let res = gen.next();
    while (!res.done) {
      yield (i + res.value) / levels.length;
      res = gen.next();
    }

    results.push({
      ...res.value,
      labels: labels ? getLabelAnchors(res.value, labels) : [],
    });
  }

  return results;
}

export function isosurfaceSteps(
  values: ArrayLike<number>,
  shape: [number, number, number],
  axisValues: AxisCoords,
  level: number,
  scaleType: ScaleTypeParam,
  step: number,
): Generator<number, IsosurfaceGeometry> {
  return marchingCubesSteps(values, shape, level, {
    scaleType,
    step,
    axisValues,
  });
}

export function runSteps<T>(gen: Generator<number, T>): T {
  let res = gen.next();
  while (!res.done) {
    res = gen.next();
  }
  return res.value;
}
