import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import {
  arrayShape,
  cplx,
  cplxType,
  floatType,
  intType,
  scalarShape,
} from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';

/* Poles and zeros of transfer functions on the complex plane (`H5WEB_vis = "complex_points"`),
 * with zeros, the unit circle and the imaginary axis as overlays */

function polar(r: number, theta: number) {
  return cplx(r * Math.cos(theta), r * Math.sin(theta));
}

function complexArray(name: string, values: unknown[], attrs: object) {
  return dataset(
    name,
    arrayShape([values.length]),
    cplxType(floatType()),
    values,
    {
      attributes: Object.entries(attrs).map(([key, val]) =>
        typeof val === 'number'
          ? arrayAttr(key, [val], { type: intType(true, 8) })
          : scalarAttr(key, val),
      ),
    },
  );
}

export function makePoleZeroGroup(): GroupWithChildren {
  return group('pole_zero', [
    // z-plane: a conjugate pair, a double pole (as computed: not quite equal) and three zeros,
    // two of them a conjugate pair on the unit circle
    complexArray(
      'poles',
      [polar(0.9, 0.3), polar(0.9, -0.3), cplx(0.5, 0), cplx(0.5 + 1e-9, 0)],
      {
        H5WEB_vis: 'complex_points',
        H5WEB_marker: 'x',
        H5WEB_label: 'Poles',
        H5WEB_overlays: 'zeros unit_circle',
      },
    ),
    complexArray('zeros', [polar(1, 1.2), polar(1, -1.2), cplx(-1, 0)], {
      H5WEB_geometry: 'points',
      H5WEB_marker: 'o',
      H5WEB_label: 'Zeros',
    }),
    dataset('unit_circle', arrayShape([3]), floatType(), [0, 0, 1], {
      attributes: [
        scalarAttr('H5WEB_geometry', 'circle'),
        arrayAttr('H5WEB_dash', [1], { type: intType(true, 8) }),
      ],
    }),
    // s-plane: stable poles left of the imaginary axis
    complexArray('s_poles', [cplx(-0.5, 2), cplx(-0.5, -2), cplx(-3, 0)], {
      H5WEB_vis: 'complex_points',
      H5WEB_marker: 'x',
      H5WEB_overlays: 'imag_axis',
    }),
    dataset('imag_axis', scalarShape(), floatType(), 0, {
      attributes: [
        scalarAttr('H5WEB_geometry', 'vline'),
        scalarAttr('H5WEB_label', 'ℜ s = 0'),
      ],
    }),
    // No poles: empty axes, with the overlays
    complexArray('no_poles', [], {
      H5WEB_vis: 'complex_points',
      H5WEB_overlays: 'no_zeros unit_circle',
    }),
    complexArray('no_zeros', [], { H5WEB_geometry: 'points' }),
  ]);
}
