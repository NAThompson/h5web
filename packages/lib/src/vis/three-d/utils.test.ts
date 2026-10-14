import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import {
  getAxisTicks,
  getBoxSize,
  getColorParams,
  getExtentDomain,
  getFramingDistance,
  getVertexColors,
  getWorldTransform,
  NAN_COLOR,
  updateColorAttribute,
} from './utils';

describe('getAxisTicks', () => {
  it('should return nice ticks within domain', () => {
    expect(getAxisTicks([0, 1], 5, false)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(getAxisTicks([-18, 21], 4, false)).toEqual([-10, 0, 10, 20]);
  });

  it('should support descending domains', () => {
    expect(getAxisTicks([21, -18], 4, false)).toEqual([20, 10, 0, -10]);
  });

  it('should return integer ticks for index axes', () => {
    expect(getAxisTicks([0, 3], 10, true)).toEqual([0, 1, 2, 3]);
  });
});

describe('getFramingDistance', () => {
  it('should fit sphere vertically in landscape viewport', () => {
    // sin(45 / 2) ~ 0.383
    expect(getFramingDistance(1, 45, 2)).toBeCloseTo(2.613, 3);
  });

  it('should fit sphere horizontally in portrait viewport', () => {
    expect(getFramingDistance(1, 45, 0.5)).toBeGreaterThan(
      getFramingDistance(1, 45, 1) ?? Infinity,
    );
  });

  it('should return undefined for zero-sized viewport', () => {
    expect(getFramingDistance(1, 45, Number.NaN)).toBeUndefined();
    expect(getFramingDistance(1, 45, Infinity)).toBeUndefined();
    expect(getFramingDistance(1, 45, 0)).toBeUndefined();
  });
});

describe('getExtentDomain', () => {
  it('should return domain of finite values across arrays', () => {
    expect(getExtentDomain([1, Number.NaN, 3], [-2, Infinity])).toEqual([
      -2, 3,
    ]);
  });

  it('should keep flat domain flat', () => {
    expect(getExtentDomain([2, 2, 2])).toEqual([2, 2]);
  });

  it('should return default domain if there is no finite value', () => {
    expect(getExtentDomain([Number.NaN], [])).toEqual([-0.5, 0.5]);
  });
});

describe('getBoxSize', () => {
  it('should keep ratio with longest side of 1', () => {
    expect(
      getBoxSize(
        [
          [0, 4],
          [-1, 1],
          [10, 11],
        ],
        true,
      ),
    ).toEqual([1, 0.5, 0.25]);
  });

  it('should return unit cube when not keeping ratio', () => {
    expect(
      getBoxSize(
        [
          [0, 4],
          [-1, 1],
          [10, 11],
        ],
        false,
      ),
    ).toEqual([1, 1, 1]);
  });

  it('should give zero thickness to flat domains, whatever their position', () => {
    // Small planar curve: must fill the box, not be squashed by an arbitrary thickness
    const domains: [Domain, Domain, Domain] = [
      [0, 0.01],
      [0, 0.005],
      [3, 3],
    ];
    expect(getBoxSize(domains, true)).toEqual([1, 0.5, 0]);
    expect(getBoxSize(domains, false)).toEqual([1, 1, 0]);
  });

  it('should return unit cube for single point', () => {
    expect(
      getBoxSize(
        [
          [1, 1],
          [2, 2],
          [3, 3],
        ],
        true,
      ),
    ).toEqual([1, 1, 1]);
  });
});

describe('getWorldTransform', () => {
  it('should map flat domains to middle of box', () => {
    const toWorld = getWorldTransform(
      [
        [0, 0.01],
        [5, 5],
        [3, 3],
      ],
      [1, 0, 0],
    );
    expect(toWorld(0.01, 5, 3)).toEqual([0.5, 0, 0]);

    const toWorldUnitBox = getWorldTransform(
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      [1, 1, 1],
    );
    expect(toWorldUnitBox(1, 2, 3)).toEqual([0, 0, 0.5]);
  });

  it('should map domains to box centred in X and Y, and resting on Z = 0', () => {
    const toWorld = getWorldTransform(
      [
        [0, 4],
        [-1, 1],
        [10, 11],
      ],
      [1, 0.5, 0.25],
    );
    expect(toWorld(0, -1, 10)).toEqual([-0.5, -0.25, 0]);
    expect(toWorld(4, 1, 11)).toEqual([0.5, 0.25, 0.25]);
    expect(toWorld(2, 0, 10.5)).toEqual([0, 0, 0.125]);
  });
});

describe('getColorParams', () => {
  it('should normalize values with domain and clamp', () => {
    const params = getColorParams(
      [0, 5, 10, 20, -5],
      [0, 10],
      ScaleType.Linear,
    );
    expect([...params]).toEqual([0, 0.5, 1, 1, 0]);
  });

  it('should return NaN for values that cannot be coloured', () => {
    const params = getColorParams(
      [Number.NaN, -1, 0, 10, 100, 42],
      [1, 100],
      ScaleType.Log,
      (val) => val === 42,
    );
    expect([...params]).toEqual([
      Number.NaN,
      Number.NaN,
      Number.NaN,
      0.5,
      1,
      Number.NaN,
    ]);
  });
});

describe('getVertexColors', () => {
  it('should pick colours from LUT, and NaN colour for NaN params', () => {
    const lut = Float32Array.from([0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1]);
    const colors = getVertexColors(Float32Array.from([0, 1, Number.NaN]), lut);
    expect([...colors]).toEqual([
      0,
      0,
      0,
      1,
      1,
      1,
      ...Float32Array.from(NAN_COLOR),
    ]);
  });
});

describe('updateColorAttribute', () => {
  it('should update existing attribute in place, shared by all geometries', () => {
    const surface = new BufferGeometry();
    const wire = new BufferGeometry();

    const attr = updateColorAttribute(
      [surface, wire],
      Float32Array.from([0, 0, 0]),
    );
    expect(surface.getAttribute('color')).toBe(attr);
    expect(wire.getAttribute('color')).toBe(attr);
    const { version } = attr;

    const updated = updateColorAttribute(
      [surface, wire],
      Float32Array.from([1, 1, 1]),
    );
    expect(updated).toBe(attr); // no new GPU buffer
    expect([...attr.array]).toEqual([1, 1, 1]);
    expect(attr.version).toBe(version + 1); // re-uploaded
  });

  it('should replace attribute when vertex count changes', () => {
    const geometry = new BufferGeometry();
    const attr = updateColorAttribute([geometry], new Float32Array(3));
    const replaced = updateColorAttribute([geometry], new Float32Array(6));
    expect(replaced).not.toBe(attr);
    expect(geometry.getAttribute('color')).toBe(replaced);
  });
});
