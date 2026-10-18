import { H5T_CSET, H5T_STR } from '@h5web/shared/h5t';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import {
  arrayShape,
  arrayType,
  boolType,
  compoundType,
  cplx,
  cplxType,
  enumType,
  floatType,
  intType,
  nullShape,
  opaqueType,
  scalarShape,
  strType,
  unknownType,
  vlenType,
} from '@h5web/shared/hdf5-utils';
import {
  array,
  arrayAttr,
  dataset,
  datatype,
  group,
  nxData,
  nxGroup,
  scalar,
  scalarAttr,
  unresolved,
  withDimScales,
  withImageAttr,
  withNxAttr,
} from '@h5web/shared/mock-utils';
import { ScaleType } from '@h5web/shared/vis-models';

const PNG_RED_DOT = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x05, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x8d, 0x6f, 0x26, 0xe5, 0x00, 0x00, 0x00, 0x1c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0xc3, 0x7f, 0x06, 0x20,
  0x05, 0xc3, 0x20, 0x12, 0x84, 0xd0, 0x31, 0xf1, 0x82, 0x58, 0xcd, 0x04, 0x00,
  0x0e, 0xf5, 0x35, 0xcb, 0xd1, 0x8e, 0x0e, 0x1f, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const ENUM_MAPPING = { FOO: 0, BAR: 1, BAZ: 2 };

/* View attributes as netCDF-4 writes them: numbers as 1-element arrays, booleans as `Int8` */
function intAttr(name: string, value: number) {
  return arrayAttr(name, [value], { type: intType(true, 8) });
}
function floatAttr(name: string, ...values: number[]) {
  return arrayAttr(name, values, { type: floatType(64) });
}

// Axis values of `axis_hints`: log-spaced ρ from 1e-3 to 1e2, χ from -1000 to 1000
const RHO = Array.from({ length: 12 }, (_, i) => 10 ** (-3 + (5 * i) / 11));
const CHI = [-1000, -100, -10, -1, 0, 1, 10, 100, 1000];
// Log-spaced from 0.01 to 100, and a volume that is 1 where x < 1 (first half of the voxels)
const RHO_VOLUME = Array.from(
  { length: 16 },
  (_, i) => 10 ** (-2 + (4 * i) / 15),
);
const NEAR_ORIGIN = Array.from({ length: 12 * 12 * 16 }, (_, i) =>
  RHO_VOLUME[i % 16] < 1 ? 1 : 0,
);

function indices(length = 60) {
  return Array.from({ length }, (_, i) => i);
}

// 1 at the centre of a 12³ volume down to 1e-12 in its corners
const DECADES = indices(12 ** 3).map((i) => {
  const [z, y, x] = [Math.floor(i / 144), Math.floor(i / 12) % 12, i % 12];
  const r2 = (x - 5.5) ** 2 + (y - 5.5) ** 2 + (z - 5.5) ** 2;
  return 10 ** ((-12 * r2) / (3 * 5.5 ** 2));
});

export function makeMockFile(): GroupWithChildren {
  return nxGroup('source.h5', 'NXroot', {
    isRoot: true,
    defaultPath: 'nexus',
    children: [
      group('entities', [
        group('group_empty'),
        group('group_default_dataset', [scalar('data', 'foo')], {
          attributes: [scalarAttr('default', 'data')],
        }),
        dataset('dataset_empty', nullShape(), unknownType(), null),
        datatype('datatype', compoundType([['int', intType()]])),
        unresolved('unresolved_hard_link', 'Hard'),
        unresolved('unresolved_soft_link', 'Soft', '/foo'),
        unresolved(
          'unresolved_external_link',
          'External',
          'entry_000/dataset',
          'my_file.h5',
        ),
      ]),
      group('scalars', [
        scalar('number', 0, { attributes: [scalarAttr('attr', 0)] }),
        scalar('bigint', BigInt(Number.MAX_SAFE_INTEGER) + 1n, {
          attributes: [
            scalarAttr('attr', BigInt(Number.MAX_SAFE_INTEGER) + 1n),
          ],
        }),
        scalar('string', 'foo', {
          attributes: [scalarAttr('attr', 'foo')],
        }),
        scalar('boolean', true, { attributes: [scalarAttr('attr', true)] }),
        scalar('enum', 2, {
          type: enumType(intType(false, 8), ENUM_MAPPING),
          attributes: [
            scalarAttr('attr', 2, {
              type: enumType(intType(false, 8), ENUM_MAPPING),
            }),
          ],
        }),
        scalar('complex', [1, 5], {
          attributes: [scalarAttr('attr', cplx(1, 5))],
        }),
        scalar('compound', ['foo', 2], {
          type: compoundType([
            ['str', strType(H5T_CSET.ASCII, H5T_STR.NULLPAD, 3)],
            ['int', intType(true, 8)],
          ]),
          attributes: [
            scalarAttr('attr', ['foo', 2], {
              type: compoundType([
                ['str', strType(H5T_CSET.UTF8)],
                ['int', intType(true, 8)],
              ]),
            }),
          ],
        }),
        scalar('array', [1, 2], {
          type: arrayType(intType(), [2]),
          attributes: [
            scalarAttr('attr', [1, 2], { type: arrayType(intType(), [2]) }),
          ],
        }),
        scalar('vlen', [1, 2, 3], {
          type: vlenType(intType()),
          attributes: [
            scalarAttr('attr', [1, 2, 3], { type: vlenType(intType()) }),
          ],
        }),
        dataset('opaque_png', scalarShape(), opaqueType(), PNG_RED_DOT),
        scalar('unknown', { int: 42 }),
        scalar('unknown_large', undefined), // generated dynamically by `MockProvider`
      ]),
      group('arrays', [
        group('typed', [
          array('uint8', { type: intType(false, 8) }),
          array('int16', { type: intType(true, 16) }),
          array('int64', { type: intType(true, 64) }),
          array('float16', { type: floatType(16) }),
          array('float32', { type: floatType(32) }),
          array('float64', { type: floatType(64) }),
          withImageAttr(array('uint8_rgb', { type: intType(false, 8) })),
          withImageAttr(array('int8_rgb', { type: intType(true, 8) })),
          withImageAttr(array('int32_rgb', { type: intType(true, 32) })),
          withImageAttr(array('float32_rgb', { type: floatType(32) })),
        ]),
        array('oneD'),
        array('oneD_linear'),
        array('oneD_bigint'),
        array('oneD_string', {
          type: strType(H5T_CSET.ASCII, H5T_STR.SPACEPAD, 256),
        }),
        array('oneD_boolean'),
        array('oneD_enum', {
          type: enumType(intType(false, 8), ENUM_MAPPING),
        }),
        array('oneD_complex'),
        array('oneD_compound', {
          type: compoundType([
            ['string', strType()],
            ['int', intType()],
            ['float', floatType()],
            ['bool', boolType(intType(true, 8))],
            ['complex', cplxType(floatType())],
          ]),
        }),
        dataset(
          'oneD_compound_mixed',
          arrayShape([1]),
          compoundType([
            ['opaque', opaqueType()],
            ['arr', arrayType(intType(), [2])],
            [
              'nested',
              compoundType([
                ['bool', boolType(intType(true, 8))],
                ['vlen', vlenType(intType())],
              ]),
            ],
          ]),
          [[{ int: 42 }, [1, 2], [true, [0]]]],
        ),
        dataset('oneD_opaque', arrayShape([2]), opaqueType(), [
          'foo',
          { int: 42 },
        ]),
        dataset('oneD_opaque_png', arrayShape([2]), opaqueType(), [
          PNG_RED_DOT,
          PNG_RED_DOT,
        ]),
        array('twoD'),
        array('twoD_negative'),
        array('twoD_bigint'),
        array('twoD_boolean'),
        array('twoD_enum', {
          type: enumType(intType(false, 8), ENUM_MAPPING),
        }),
        array('twoD_complex'),
        array('twoD_compound', {
          type: compoundType([
            ['string', strType()],
            ['int', intType()],
            ['float', floatType()],
            ['bool', boolType(intType(true, 8))],
            ['complex', cplxType(floatType())],
          ]),
        }),
        array('twoD_opaque', { type: opaqueType() }),
        array('threeD', {
          chunks: [1, 20, 41],
          filters: [{ id: 12_345, name: 'Some filter' }],
        }),
        array('threeD_boolean'),
        array('threeD_complex'),
        withImageAttr(array('threeD_rgb')),
        withImageAttr(array('threeD_rgba')),
        array('threeD_volume'),
        array('fourD'),
      ]),
      nxGroup('nexus', 'NXentry', {
        defaultPath: 'NXdata',
        children: [
          nxData('NXdata', {
            signal: array('twoD'),
            silxStyle: { signalScaleType: ScaleType.SymLog },
            title: scalar('title', 'NeXus 2D'),
          }),
          nxGroup('NXnote', 'NXnote', {
            children: [
              scalar(
                'data',
                JSON.stringify({
                  energy: 10.2,
                  geometry: { dist: 0.1, rot: 0.074 },
                }),
              ),
              scalar('type', 'application/json'),
            ],
          }),
          nxGroup('default_absolute', 'NXentry', {
            defaultPath: '/nexus/NXdata',
          }),
          nxGroup('default_implicit', 'NXprocess', {
            defaultPath: undefined,
            children: [
              nxGroup('ignore_me', 'NXentry'),
              nxData('spectrum', { signal: array('oneD') }),
            ],
          }),
          nxData('spectrum', {
            signal: withNxAttr(array('twoD'), {
              interpretation: 'spectrum',
              units: 'arb. units',
            }),
            errors: array('errors', { valueId: 'twoD_errors' }),
            axes: { X: withNxAttr(array('X'), { units: 'nm' }) },
            axesAttr: ['.', 'X'],
          }),
          nxData('spectrum_with_aux', {
            signal: withNxAttr(array('twoD'), {
              interpretation: 'spectrum',
              units: 'arb. units',
            }),
            errors: array('errors', { valueId: 'twoD_errors' }),
            axes: { X: withNxAttr(array('X'), { units: 'nm' }) },
            axesAttr: ['.', 'X'],
            auxiliary: {
              secondary: array('secondary'),
              tertiary: array('tertiary_cplx'),
            },
            auxAttr: ['secondary', 'tertiary_cplx'],
            children: [array('secondary_errors', { valueId: 'twoD_errors' })],
          }),
          nxData('spectrum_log', {
            signal: array('oneD'),
            errors: array('oneD_errors'),
            axes: { X_log: array('X_log') },
            axesAttr: ['X_log'],
            silxStyle: {
              signalScaleType: ScaleType.Log,
              axisScaleTypes: [ScaleType.Log],
            },
          }),
          nxData('spectrum_complex', {
            signal: withNxAttr(array('twoD_complex'), {
              interpretation: 'spectrum',
            }),
            auxiliary: {
              secondary_cplx: array('secondary_cplx'),
              tertiary_float: array('tertiary_float'),
            },
            auxAttr: ['secondary_cplx', 'tertiary_float'],
          }),
          nxData('image', {
            signal: withNxAttr(array('fourD'), {
              longName: 'Interference fringes',
              interpretation: 'image',
            }),
            axes: {
              X: withNxAttr(array('X'), { units: 'nm' }),
              Y: withNxAttr(array('Y'), {
                units: 'deg',
                longName: 'Angle (degrees)',
              }),
            },
            axesAttr: ['.', '.', 'Y', 'X'],
            silxStyle: { signalScaleType: ScaleType.Log },
          }),
          nxData('image_with_aux', {
            signal: withNxAttr(array('twoD'), {
              interpretation: 'image',
            }),
            axes: { X: array('X'), Y: array('Y') },
            axesAttr: ['Y', 'X'],
            auxiliary: {
              secondary: array('secondary'),
              tertiary: array('tertiary'),
            },
            auxAttr: ['secondary', 'tertiary'],
          }),
          nxData('image_complex', {
            signal: array('twoD_complex'),
            axes: { position: array('position') },
            axesAttr: ['.', 'position'],
            auxiliary: {
              secondary_cplx: array('secondary_cplx'),
              tertiary_float: array('tertiary_float'),
            },
            auxAttr: ['secondary_cplx', 'tertiary_float'],
          }),
          nxData('rgb-image', {
            signal: withImageAttr(
              withNxAttr(array('fourD_rgb'), {
                longName: 'RGB',
                interpretation: 'rgb-image',
              }),
            ),
            axes: { X_rgb: array('X_rgb'), Y_rgb: array('Y_rgb') },
            axesAttr: ['.', 'Y_rgb', 'X_rgb'],
          }),
          nxData('rgba-image', {
            signal: withImageAttr(
              withNxAttr(array('threeD_rgba'), {
                longName: 'RGBA',
                interpretation: 'rgba-image',
              }),
            ),
          }),
          nxData('descending-axes', {
            signal: array('twoD'),
            axes: { X_desc: array('X_desc'), Y_desc: array('Y_desc') },
            axesAttr: ['Y_desc', 'X_desc'],
          }),
          nxData('scatter', {
            signal: array('scatter_data'),
            axes: { X_desc: array('X_desc'), Y_scatter: array('Y_scatter') },
            axesAttr: ['X_desc', 'Y_scatter'],
          }),
          nxData('bigint', {
            signal: array('twoD_bigint'),
            auxiliary: { secondary_bigint: array('secondary_bigint') },
            auxAttr: ['secondary_bigint'],
            axes: { X_bigint: array('X_bigint') },
            axesAttr: ['.', 'X_bigint'],
          }),
          nxGroup('old-style', 'NXdata', {
            children: [
              array('twoD', {
                attributes: [
                  scalarAttr('signal', 1),
                  scalarAttr('axes', 'Y:X'),
                ],
              }),
              withNxAttr(array('X'), { units: 'nm' }),
              withNxAttr(array('Y'), {
                units: 'deg',
                longName: 'Angle (degrees)',
              }),
            ],
          }),
          nxGroup('numeric-like', 'NXprocess', {
            children: [
              nxData('bool', {
                signal: array('twoD_boolean'),
                auxiliary: { secondary_boolean: array('secondary_boolean') },
                auxAttr: ['secondary_boolean'],
              }),
              nxData('enum', {
                signal: array('twoD_enum', {
                  type: enumType(intType(false, 8), ENUM_MAPPING),
                }),
                auxiliary: {
                  secondary_enum: array('secondary_enum', {
                    type: enumType(intType(false, 8), ENUM_MAPPING),
                  }),
                },
                auxAttr: ['secondary_enum'],
              }),
            ],
          }),
          nxData('default_slice', {
            signal: array('fourD'),
            attributes: [arrayAttr('default_slice', ['1', '.', '2', '.'])],
          }),
          group('malformed', [
            group('default_not_found', [], {
              attributes: [scalarAttr('default', '/test')],
            }),
            group('no_signal', [], {
              attributes: [scalarAttr('NX_class', 'NXdata')],
            }),
            group('signal_not_found', [], {
              attributes: [
                scalarAttr('NX_class', 'NXdata'),
                scalarAttr('signal', 'unknown'),
              ],
            }),
            nxGroup('signal_not_dataset', 'NXdata', {
              children: [group('some_group')],
              attributes: [scalarAttr('signal', 'some_group')],
            }),
            nxGroup('signal_old-style_not_dataset', 'NXdata', {
              children: [
                group('some_group', [], {
                  attributes: [scalarAttr('signal', 1)],
                }),
              ],
            }),
            nxGroup('signal_not_array', 'NXdata', {
              children: [scalar('some_scalar', 0)],
              attributes: [scalarAttr('signal', 'some_scalar')],
            }),
            nxGroup('signal_not_numeric', 'NXdata', {
              children: [array('oneD_str')],
              attributes: [scalarAttr('signal', 'oneD_str')],
            }),
            nxData('interpretation_unknown', {
              signal: withNxAttr(array('fourD'), { interpretation: 'unknown' }),
            }),
            nxData('rgb-image_incompatible', {
              signal: withNxAttr(array('oneD'), {
                interpretation: 'rgb-image',
              }),
            }),
            nxData('default_slice_wrong_length', {
              signal: array('fourD'),
              attributes: [arrayAttr('default_slice', ['1', '.', '2'])],
            }),
            nxData('default_slice_out_of_bounds', {
              signal: array('fourD'),
              attributes: [arrayAttr('default_slice', ['3', '.', '2', '.'])], // slicing index for first dimension should be within [0, 2]
            }),
            nxData('SILX_style_unknown', {
              signal: array('oneD'),
              axes: { X: array('X') },
              axesAttr: ['X'],
              attributes: [
                scalarAttr(
                  'SILX_style',
                  JSON.stringify({
                    unknown: ScaleType.Log,
                    signal_scale_type: 'invalid',
                    axes_scale_type: ['invalid'],
                  }),
                ),
              ],
            }),
            nxData('SILX_style_malformed', {
              signal: array('oneD'),
              attributes: [scalarAttr('SILX_style', '{')],
            }),
            nxGroup('NXnote_invalid_json', 'NXnote', {
              children: [
                scalar('data', "{foo: 'bar'}"),
                scalar('type', 'application/json'),
              ],
            }),
            nxGroup('NXnote_unknown_mime_type', 'NXnote', {
              children: [
                scalar('data', 'foo: bar'),
                scalar('type', 'application/yaml'),
              ],
            }),
          ]),
        ],
      }),
      group('netcdf', [
        array('valid_min', {
          valueId: 'twoD',
          attributes: [scalar('valid_min', 5)],
        }),
        array('valid_max', {
          valueId: 'twoD',
          attributes: [scalar('valid_max', 200)],
        }),
        array('valid_min_max', {
          valueId: 'twoD',
          attributes: [scalar('valid_min', 5), scalar('valid_max', 200)],
        }),
        array('valid_range', {
          valueId: 'twoD',
          attributes: [
            dataset('valid_range', arrayShape([2]), floatType(), [5, 200]),
          ],
        }),
        array('_FillValue', {
          valueId: 'twoD',
          attributes: [scalar('_FillValue', 100)],
        }),
        array('_FillValue (negative)', {
          valueId: 'twoD',
          attributes: [scalar('_FillValue', -9)],
        }),
        array('scale_factor', {
          valueId: 'twoD',
          type: intType(true, 16),
          attributes: [scalar('scale_factor', 0.5)],
        }),
        array('scale_factor_add_offset', {
          valueId: 'twoD',
          type: intType(true, 16),
          attributes: [
            // NetCDF4 stores numeric attributes as single-element arrays
            dataset('scale_factor', arrayShape([1]), floatType(32), [0.5]),
            dataset('add_offset', arrayShape([1]), floatType(32), [10]),
            dataset('_FillValue', arrayShape([1]), intType(true, 16), [100]),
          ],
        }),
        array('scale_factor_valid_range', {
          valueId: 'twoD',
          type: intType(true, 16),
          attributes: [
            scalar('scale_factor', 0.5, { type: floatType(32) }),
            scalar('add_offset', 10, { type: floatType(32) }),
            // Same type as `scale_factor` and `add_offset`, so in unpacked units
            dataset('valid_range', arrayShape([2]), floatType(32), [0, 50]),
          ],
        }),
      ]),
      group('dimension_scales', [
        array('X', { attributes: [scalarAttr('units', 'nm')] }),
        array('X_named', {
          valueId: 'X',
          attributes: [
            scalarAttr('NAME', 'abscissa'),
            scalarAttr('units', 'nm'),
          ],
        }),
        array('Y'), // too short to scale a `oneD` or `twoD` dimension
        withDimScales(array('oneD', { valueId: 'oneD' }), {
          labels: ['position'],
          scales: [['/dimension_scales/X']],
        }),
        withDimScales(array('oneD_named_scale', { valueId: 'oneD' }), {
          // No dimension label, so the name given to `make_scale` is used
          scales: [['/dimension_scales/X_named']],
        }),
        withDimScales(array('oneD_label_only', { valueId: 'oneD' }), {
          labels: ['position'],
        }),
        withDimScales(array('oneD_multi_scale', { valueId: 'oneD' }), {
          labels: ['position'],
          // `Y` is attached first but is the wrong length, so `X` is used
          scales: [['/dimension_scales/Y', '/dimension_scales/X']],
        }),
        array('error_value', { valueId: 'X' }), // fails to load, see `MockApi#getValue`
        withDimScales(array('oneD_unreadable_scale', { valueId: 'oneD' }), {
          // `error_value` has the right shape but can't be read, so `X` is used
          scales: [['/dimension_scales/error_value', '/dimension_scales/X']],
        }),
        array('network_error_value', { valueId: 'X' }), // see `MockApi#getValue`
        withDimScales(array('oneD_network_error_scale', { valueId: 'oneD' }), {
          // Can't tell whether `network_error_value` is usable, so `X` must not be used instead
          scales: [
            ['/dimension_scales/network_error_value', '/dimension_scales/X'],
          ],
        }),
        withDimScales(array('twoD', { valueId: 'twoD' }), {
          labels: [undefined, 'column'],
          scales: [[], ['/dimension_scales/X']],
        }),
        array('Y_nm', {
          valueId: 'Y',
          attributes: [scalarAttr('units', 'nm')],
        }),
        array('Y_s', { valueId: 'Y', attributes: [scalarAttr('units', 's')] }),
        withDimScales(array('twoD_same_units', { valueId: 'twoD' }), {
          scales: [['/dimension_scales/Y_nm'], ['/dimension_scales/X']],
        }),
        withDimScales(array('twoD_diff_units', { valueId: 'twoD' }), {
          scales: [['/dimension_scales/Y_s'], ['/dimension_scales/X']],
        }),
        dataset(
          'T',
          arrayShape([10]),
          floatType(),
          [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          { attributes: [scalarAttr('units', 'ms')] },
        ),
        withDimScales(array('oneD_complex'), {
          labels: ['time'],
          scales: [['/dimension_scales/T']],
        }),
        array('K', { attributes: [scalarAttr('units', '1/a')] }),
        withDimScales(array('threeD_fermi'), {
          labels: ['kz', 'ky', 'kx'],
          scales: [
            ['/dimension_scales/K'],
            ['/dimension_scales/K'],
            ['/dimension_scales/K'],
          ],
        }),
        array('twoD_contours'),
        // Same band as NeXus data: offered as NX Volume (default: 3D signal, axis on every dimension)
        nxData('fermi_nxdata', {
          signal: withNxAttr(array('energy', { valueId: 'threeD_fermi' }), {
            units: 'eV',
          }),
          axes: {
            kz: withNxAttr(array('kz', { valueId: 'K' }), { units: '1/a' }),
            ky: withNxAttr(array('ky', { valueId: 'K' }), { units: '1/a' }),
            kx: withNxAttr(array('kx', { valueId: 'K' }), { units: '1/a' }),
          },
          axesAttr: ['kz', 'ky', 'kx'],
          title: scalar('title', 'Tight-binding band'),
        }),
        // Bin-edge axes, scale type suggested with `SILX_style`
        nxData('fermi_nxdata_bins', {
          signal: withNxAttr(array('energy', { valueId: 'threeD_fermi' }), {
            units: 'eV',
          }),
          axes: {
            kz: withNxAttr(array('kz', { valueId: 'K_edges' }), {
              units: '1/a',
            }),
            ky: withNxAttr(array('ky', { valueId: 'K_edges' }), {
              units: '1/a',
            }),
            kx: withNxAttr(array('kx', { valueId: 'K_edges' }), {
              units: '1/a',
            }),
          },
          axesAttr: ['kz', 'ky', 'kx'],
          silxStyle: { signalScaleType: ScaleType.SymLog },
        }),
        // Index on one of the volume's dimensions, which must be ignored by NX Volume
        // Malformed auxiliary signals, which don't apply to volumes
        nxData('volume_bad_aux', {
          signal: array('energy', { valueId: 'threeD_fermi' }),
          axes: {
            kz: array('kz', { valueId: 'K' }),
            ky: array('ky', { valueId: 'K' }),
            kx: array('kx', { valueId: 'K' }),
          },
          axesAttr: ['kz', 'ky', 'kx'],
          attributes: [arrayAttr('auxiliary_signals', ['missing'])],
        }),
        nxData('volume_default_slice', {
          signal: array('fourD'),
          attributes: [arrayAttr('default_slice', ['.', '.', '.', '5'])],
        }),
      ]),
      group('geometry', [
        array('knot_x'),
        array('knot_y'),
        array('knot_z'),
        array('knot_speed', {
          attributes: [
            scalarAttr('coordinates', 'knot_x knot_y knot_z'),
            scalarAttr('featureType', 'trajectory'), // points are connected
          ],
        }),
        // Same knot, with x, y, z attached as HDF5 dimension scales instead of `coordinates`
        ...(['x', 'y', 'z'] as const).map((axis) =>
          array(`knot_${axis}_scale`, {
            valueId: `knot_${axis}`,
            attributes: [
              scalarAttr('CLASS', 'DIMENSION_SCALE'),
              scalarAttr('NAME', axis),
            ],
          }),
        ),
        withDimScales(
          array('knot_speed_dimscales', {
            valueId: 'knot_speed',
            attributes: [scalarAttr('featureType', 'trajectory')],
          }),
          {
            scales: [
              [
                '/geometry/knot_x_scale',
                '/geometry/knot_y_scale',
                '/geometry/knot_z_scale',
              ],
            ],
          },
        ),
        withDimScales(
          array('knot_speed_phases_dimscales', {
            valueId: 'knot_speed_phases',
            attributes: [scalarAttr('featureType', 'trajectory')],
          }),
          {
            labels: ['phase', 't'],
            scales: [
              [],
              [
                '/geometry/knot_x_scale',
                '/geometry/knot_y_scale',
                '/geometry/knot_z_scale',
              ],
            ],
          },
        ),
        // Common NetCDF case: a single coordinate variable attached to the dimension (not a curve)
        withDimScales(
          array('netcdf_variable', {
            valueId: 'oneD',
            attributes: [scalarAttr('featureType', 'trajectory')],
          }),
          { scales: [['/dimension_scales/X']] },
        ),
        array('torus_x', { attributes: [scalarAttr('units', 'm')] }),
        array('torus_y', { attributes: [scalarAttr('units', 'm')] }),
        array('torus_z', { attributes: [scalarAttr('units', 'm')] }),
        array('torus_curvature', {
          attributes: [
            scalarAttr('coordinates', 'torus_x torus_y torus_z'),
            scalarAttr('long_name', 'Gaussian curvature'),
            scalarAttr('units', 'm^-2'),
          ],
        }),
        // `H5WEB_*` attributes opening the heatmap, while the user switches to the surface
        array('torus_hinted', {
          valueId: 'torus_curvature',
          attributes: [
            scalarAttr('coordinates', 'torus_x torus_y torus_z'),
            scalarAttr('H5WEB_vis', 'heatmap'),
            scalarAttr('H5WEB_scale', 'symlog'),
            scalarAttr('H5WEB_colormap', 'auto'),
            scalarAttr('H5WEB_title', 'Gaussian curvature'),
          ],
        }),
        array('torus_waves', {
          attributes: [
            // Absolute paths are supported too; leading dimension can be sliced
            scalarAttr(
              'coordinates',
              '/geometry/torus_x /geometry/torus_y /geometry/torus_z',
            ),
          ],
        }),
        array('helix', {
          attributes: [scalarAttr('interpretation', 'vertex')],
        }),
        // Not curves or surfaces
        array('helix_table', { valueId: 'helix' }), // no `interpretation`
        array('knot_coordinates_missing', {
          valueId: 'knot_speed',
          attributes: [scalarAttr('coordinates', 'knot_x knot_y unknown')],
        }),
        array('torus_curvilinear', {
          valueId: 'torus_curvature',
          attributes: [scalarAttr('coordinates', 'torus_x torus_y')], // e.g. lon/lat grid
        }),
        nxGroup('nx_torus', 'NXdata', {
          attributes: [scalarAttr('signal', 'curvature')],
          children: [
            array('curvature', {
              valueId: 'torus_curvature',
              attributes: [scalarAttr('coordinates', 'x y z')],
            }),
            array('x', { valueId: 'torus_x' }),
            array('y', { valueId: 'torus_y' }),
            array('z', { valueId: 'torus_z' }),
          ],
        }),
        nxGroup('nx_torus_waves', 'NXdata', {
          attributes: [
            scalarAttr('signal', 'waves'),
            arrayAttr('default_slice', ['2', '.', '.']),
          ],
          children: [
            array('waves', {
              valueId: 'torus_waves',
              attributes: [
                scalarAttr('coordinates', '../torus_x ../torus_y ../torus_z'),
              ],
            }),
          ],
        }),
      ]),
      // `H5WEB_*` axis settings on dimension scales, slicing and volumes
      group('axis_hints', [
        // `H5WEB_axis_scale`: log-spaced ρ on a log axis, χ on a symlog axis
        dataset('rho', arrayShape([12]), floatType(), RHO, {
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'rho'),
            scalarAttr('H5WEB_axis_scale', 'Log'),
          ],
        }),
        dataset('chi', arrayShape([9]), floatType(), CHI, {
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'chi'),
            scalarAttr('H5WEB_axis_scale', 'symlog'),
            floatAttr('H5WEB_symlog_threshold', 10),
          ],
        }),
        withDimScales(
          dataset(
            'log_heatmap',
            arrayShape([9, 12]),
            floatType(),
            CHI.flatMap((chi) => RHO.map((rho) => Math.log10(rho) + chi / 100)),
            { attributes: [intAttr('H5WEB_keep_ratio', 0)] },
          ),
          { scales: [['/axis_hints/chi'], ['/axis_hints/rho']] },
        ),
        withDimScales(
          dataset(
            'log_line',
            arrayShape([12]),
            floatType(),
            RHO.map((rho) => Math.exp(-rho)),
            { attributes: [scalarAttr('H5WEB_vis', 'line')] },
          ),
          { scales: [['/axis_hints/rho']] },
        ),
        // Non-positive values can't be on a log axis; invalid value
        dataset('zero_based', arrayShape([12]), floatType(), indices(12), {
          attributes: [scalarAttr('H5WEB_axis_scale', 'log')],
        }),
        dataset('bad_scale', arrayShape([9]), floatType(), CHI, {
          attributes: [scalarAttr('H5WEB_axis_scale', 'decibel')],
        }),
        withDimScales(
          dataset(
            'log_fallback',
            arrayShape([9, 12]),
            floatType(),
            CHI.flatMap((chi) => RHO.map((rho) => rho + chi)),
            { attributes: [intAttr('H5WEB_keep_ratio', 0)] },
          ),
          { scales: [['/axis_hints/bad_scale'], ['/axis_hints/zero_based']] },
        ),
        // `H5WEB_keep_ratio` only for axes of the same unit and on linear scales
        ...(
          [
            ['ratio_angle', 3, 'rad'],
            ['ratio_r1', 4, 'bohr'],
            ['ratio_r2', 5, 'bohr'],
          ] as const
        ).map(([name, size, unit]) =>
          dataset(name, arrayShape([size]), floatType(), indices(size), {
            attributes: [
              scalarAttr('CLASS', 'DIMENSION_SCALE'),
              scalarAttr('NAME', name.slice(6)),
              scalarAttr('units', unit),
            ],
          }),
        ),
        withDimScales(
          dataset(
            'ratio',
            arrayShape([3, 12, 4, 5]),
            floatType(),
            indices(720),
            {
              attributes: [
                scalarAttr('H5WEB_vis', 'heatmap'),
                intAttr('H5WEB_keep_ratio', 1),
              ],
            },
          ),
          {
            scales: [
              ['/axis_hints/ratio_angle'],
              ['/axis_hints/rho'], // log
              ['/axis_hints/ratio_r1'],
              ['/axis_hints/ratio_r2'],
            ],
          },
        ),
        // `H5WEB_slice_labels`: names of the slices, as variable-length strings (netCDF-4
        // `NC_STRING`) on a numeric scale, or as the values of a fixed-length string scale
        dataset('package_label', arrayShape([4]), strType(H5T_CSET.UTF8), [
          'ψ10',
          'ψ20',
          'ψ21',
          'ψ30',
        ]),
        dataset('package_index', arrayShape([4]), intType(), [1, 2, 3, 4], {
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'package_index'),
            scalarAttr('H5WEB_slice_labels', 'package_label'),
          ],
        }),
        withDimScales(
          dataset('packages', arrayShape([4, 3, 5]), floatType(), indices()),
          { scales: [['/axis_hints/package_index'], [], []] },
        ),
        dataset(
          'blend_angle',
          arrayShape([3]),
          strType(H5T_CSET.ASCII, H5T_STR.NULLPAD, 8),
          ['0 deg', '30 deg', '60 deg'],
          {
            attributes: [
              scalarAttr('CLASS', 'DIMENSION_SCALE'),
              scalarAttr('NAME', 'angle'),
            ],
          },
        ),
        withDimScales(
          dataset('blend', arrayShape([3, 5]), floatType(), indices(15), {
            attributes: [
              scalarAttr('H5WEB_vis', 'line'),
              intAttr('H5WEB_multi_dim', 0),
            ],
          }),
          { scales: [['/axis_hints/blend_angle'], []] },
        ),
        // On the dataset: labels the only dimension of their length
        dataset('own_labels', arrayShape([4, 3, 5]), floatType(), indices(), {
          attributes: [scalarAttr('H5WEB_slice_labels', 'package_label')],
        }),
        dataset('bad_labels', arrayShape([4, 3, 5]), floatType(), indices(), {
          attributes: [scalarAttr('H5WEB_slice_labels', 'rho')],
        }),
        dataset(
          'many_labels',
          arrayShape([10_001]),
          strType(),
          indices(10_001).map(String),
        ),
        dataset(
          'too_many_labels',
          arrayShape([10_001]),
          floatType(),
          indices(10_001),
          {
            attributes: [scalarAttr('H5WEB_slice_labels', 'many_labels')],
          },
        ),
        // `H5WEB_playback_dim` (path of its scale): empty images skipped along it on load
        dataset('step', arrayShape([4]), intType(), [0, 1, 2, 3], {
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'step'),
          ],
        }),
        withDimScales(
          dataset(
            'playback_dim',
            arrayShape([3, 4, 2, 3]),
            floatType(),
            indices(72).map((i) => (i % 24 < 12 ? Number.NaN : i)), // step < 2
            {
              attributes: [
                intAttr('H5WEB_playback_skip_empty', 1),
                scalarAttr('H5WEB_playback_dim', '/axis_hints/step'),
              ],
            },
          ),
          { scales: [[], ['/axis_hints/step'], [], []] },
        ),
        // `H5WEB_scale` of volumes: density over 12 decades; signed, symlog with its threshold
        dataset('volume_log', arrayShape([12, 12, 12]), floatType(), DECADES, {
          attributes: [
            scalarAttr('H5WEB_vis', 'volume'),
            scalarAttr('H5WEB_scale', 'log'),
          ],
        }),
        dataset(
          'volume_exp10',
          arrayShape([12, 12, 12]),
          floatType(),
          DECADES.map(Math.log10),
          {
            attributes: [
              scalarAttr('H5WEB_vis', 'volume'),
              scalarAttr('H5WEB_value_transform', 'exp10'),
            ],
          },
        ),
        dataset(
          'volume_symlog',
          arrayShape([12, 12, 12]),
          floatType(),
          DECADES.map((val, i) => (i < 6 * 144 ? -val : val)), // negative below z = 6
          {
            attributes: [
              scalarAttr('H5WEB_vis', 'volume'),
              scalarAttr('H5WEB_scale', 'symlog'),
              floatAttr('H5WEB_symlog_threshold', 1e-9),
            ],
          },
        ),
        // Volume on a log-spaced x axis: voxels at their coordinates, x < 1 (half the voxels) thin
        dataset('rho_volume', arrayShape([16]), floatType(), RHO_VOLUME, {
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'rho'),
          ],
        }),
        withDimScales(
          dataset(
            'volume_nonuniform',
            arrayShape([12, 12, 16]),
            floatType(),
            NEAR_ORIGIN,
            { attributes: [scalarAttr('H5WEB_vis', 'volume')] },
          ),
          { scales: [[], [], ['/axis_hints/rho_volume']] },
        ),
        dataset(
          'volume_uniform',
          arrayShape([12, 12, 16]),
          floatType(),
          NEAR_ORIGIN,
          {
            attributes: [scalarAttr('H5WEB_vis', 'volume')],
          },
        ),
      ]),
      // `H5WEB_*` view attributes: default vis and settings, overlays linked by the `generation`
      // scale, whose geometry and style are attributes of the overlay objects
      group('view_hints', [
        array('generation', {
          valueId: 'cma_generation',
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'generation'),
          ],
        }),
        ...(
          [
            [
              'population',
              'cma_population',
              3,
              [
                scalarAttr('H5WEB_geometry', 'points'),
                scalarAttr('H5WEB_color_by', 'fitness'),
                floatAttr('H5WEB_size', 6),
              ],
            ],
            ['fitness', 'cma_fitness', 2, []],
            [
              'mean',
              'cma_mean',
              2,
              [
                scalarAttr('H5WEB_geometry', 'curve'),
                intAttr('H5WEB_trail', 1),
              ],
            ],
            ['C', 'cma_cov', 3, []],
            ['sigma', 'cma_sigma', 1, []],
          ] as const
        ).map(([name, valueId, rank, attributes]) =>
          withDimScales(array(name, { valueId, attributes: [...attributes] }), {
            scales: [
              ['/view_hints/generation'],
              ...Array.from({ length: rank - 1 }, () => []),
            ],
          }),
        ),
        group('ellipse', [], {
          attributes: [
            scalarAttr('H5WEB_geometry', 'ellipse'),
            scalarAttr('H5WEB_mean', 'mean'), // bare names: found in ancestor groups
            scalarAttr('H5WEB_cov', 'C'),
            scalarAttr('H5WEB_sigma', 'sigma'),
          ],
        }),
        group('ellipse_broken', [], {
          attributes: [
            scalarAttr('H5WEB_geometry', 'ellipse'),
            scalarAttr('H5WEB_mean', 'sigma'),
            scalarAttr('H5WEB_cov', 'C'),
          ],
        }),
        array('landscape', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('H5WEB_vis', 'heatmap'),
            scalarAttr('H5WEB_scale', 'symlog'),
            scalarAttr('H5WEB_colormap', 'Inferno'),
            scalarAttr('H5WEB_slice_by', 'generation'), // no generation dimension: extra slider
            scalarAttr('H5WEB_overlays', 'population ellipse mean'),
          ],
        }),
        // Generation dimension of its own: overlays follow its slider
        withDimScales(
          array('landscapes', {
            valueId: 'cma_landscapes',
            attributes: [scalarAttr('H5WEB_overlays', 'population')],
          }),
          { scales: [['/view_hints/generation'], [], []] },
        ),
        array('landscape_broken', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('H5WEB_overlays', 'missing ellipse_broken population'),
          ],
        }),
        // Static overlays (no linked dimension) in axis values, on the edges of [0, π]²
        array('alpha', { valueId: 'psi_axis' }),
        array('theta', { valueId: 'psi_axis' }),
        array('edge_0', {
          valueId: 'psi_edge_0',
          attributes: [
            scalarAttr('H5WEB_geometry', 'curve'),
            scalarAttr('H5WEB_columns', 'alpha theta'),
            scalarAttr('H5WEB_color', '#000'),
            scalarAttr('H5WEB_label', 'e–n'),
          ],
        }),
        array('edge_pi', {
          valueId: 'psi_edge_pi',
          attributes: [
            scalarAttr('H5WEB_geometry', 'curve'),
            scalarAttr('H5WEB_columns', 'alpha theta'),
            scalarAttr('H5WEB_color', '#000'),
            scalarAttr('H5WEB_dash', true), // h5py boolean
          ],
        }),
        array('psi_point', {
          attributes: [
            scalarAttr('H5WEB_geometry', 'points'),
            scalarAttr('H5WEB_columns', 'alpha theta'),
            scalarAttr('H5WEB_label', 'e–e'),
            scalarAttr('H5WEB_label_mode', 'Inline'),
            scalarAttr('H5WEB_legend_label', 'coalescence'), // in legend too
          ],
        }),
        scalar('theta_0', 'θ = 0', {
          attributes: [
            scalarAttr('H5WEB_geometry', 'text'),
            scalarAttr('H5WEB_columns', 'alpha theta'),
            floatAttr('H5WEB_at', Math.PI / 4, 0),
            scalarAttr('H5WEB_anchor', 'top'),
          ],
        }),
        withDimScales(
          array('psi', {
            attributes: [
              scalarAttr('long_name', 'ψ(α, θ)'),
              scalarAttr('H5WEB_vis', 'heatmap'),
              scalarAttr('H5WEB_scale', 'symlog'),
              scalarAttr('H5WEB_colormap', 'auto'), // data changes sign: diverging, symmetric
              scalarAttr('H5WEB_overlays', 'edge_0 edge_pi psi_point theta_0'),
            ],
          }),
          { scales: [['/view_hints/theta'], ['/view_hints/alpha']] },
        ),
        // `H5WEB_ticks = "pi"` on a dimension scale: axis ticks at multiples of π
        array('alpha_pi', {
          valueId: 'psi_axis',
          attributes: [
            scalarAttr('H5WEB_ticks', 'Pi'),
            scalarAttr('units', 'rad'), // left off the axis label
          ],
        }),
        withDimScales(array('psi_pi', { valueId: 'psi' }), {
          scales: [['/view_hints/theta'], ['/view_hints/alpha_pi']],
        }),
        withDimScales(
          array('line_pi', {
            valueId: 'psi_axis',
            attributes: [scalarAttr('H5WEB_vis', 'line')],
          }),
          { scales: [['/view_hints/alpha_pi']] },
        ),
        // `H5WEB_symlog_threshold`: linear band of the symlog scale around 0
        ...(['heatmap', 'line'] as const).map((vis) =>
          array(`symlog_${vis}`, {
            valueId: 'decades_twoD',
            attributes: [
              scalarAttr('H5WEB_vis', vis),
              scalarAttr('H5WEB_scale', 'symlog'),
              floatAttr('H5WEB_symlog_threshold', 1e-12),
            ],
          }),
        ),
        // Emphasized zero contour (nodal lines), alone, and of another dataset on the same grid
        array('nodal', {
          attributes: [
            floatAttr('H5WEB_contour_emphasize', 0),
            intAttr('H5WEB_contour_labels', 1),
          ],
        }),
        array('nodal_amplitude', {
          attributes: [
            scalarAttr('H5WEB_contour_of', 'nodal'),
            floatAttr('H5WEB_contour_emphasize', 0),
            floatAttr('H5WEB_contour_emphasize_width', 4),
            scalarAttr('H5WEB_contour_emphasize_color', 'black'),
            intAttr('H5WEB_contour_labels', 1),
          ],
        }),
        array('contour_of_mismatch', {
          valueId: 'nodal_amplitude',
          attributes: [
            scalarAttr('H5WEB_contour_of', 'psi'),
            floatAttr('H5WEB_contour_emphasize', 0),
          ],
        }),
        // Probe: value at a pixel against κ
        array('kappa', {
          valueId: 'probe_kappa',
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'kappa'),
            scalarAttr('long_name', 'κ'),
            scalarAttr('units', '1/m'),
            scalarAttr('H5WEB_ticks', 'pi'),
          ],
        }),
        withDimScales(
          array('probe_stack', {
            attributes: [
              scalarAttr('H5WEB_probe_dim', 'kappa'),
              scalarAttr('units', 'eV'),
              intAttr('H5WEB_keep_ratio', 0), // pixels fill the canvas
            ],
          }),
          { scales: [['/view_hints/kappa'], [], []] },
        ),
        // Colour of `NaN` values, and of values beyond the domain [0, 1]
        array('nan_color', {
          valueId: 'nan_stack',
          attributes: [
            scalarAttr('H5WEB_nan_color', '#f0f'),
            intAttr('H5WEB_keep_ratio', 0), // pixels fill the canvas
          ],
        }),
        array('beyond_colors', {
          valueId: 'nan_stack',
          attributes: [
            floatAttr('H5WEB_domain', 0, 1),
            scalarAttr('H5WEB_below_color', 'rgb(0 0 255)'), // CSS colour syntax d3-color can't parse
            scalarAttr('H5WEB_above_color', 'rgb(255 0 0 / 100%)'),
            intAttr('H5WEB_keep_ratio', 0),
          ],
        }),
        // Playback skips empty images (e.g. k < 4 at p = 2)
        array('skip_blank', {
          valueId: 'triangle_stack',
          attributes: [
            intAttr('H5WEB_playback_skip_empty', 1),
            scalarAttr('H5WEB_vis', 'heatmap'),
          ],
        }),
        array('skip_blank_start', {
          valueId: 'blank_start_stack',
          attributes: [intAttr('H5WEB_playback_skip_empty', 1)],
        }),
        // Initial playback settings
        array('playback_settings', {
          valueId: 'triangle_stack',
          attributes: [
            floatAttr('H5WEB_playback_fps', 4),
            scalarAttr('H5WEB_playback_mode', 'Bounce'),
            scalarAttr('H5WEB_playback_range', 'frame'),
          ],
        }),
        // Probe in log scale, values labelled by `long_name` (also the title) without `units`
        withDimScales(
          array('probe_log', {
            valueId: 'probe_stack',
            attributes: [
              scalarAttr('H5WEB_probe_dim', 'kappa'),
              scalarAttr('H5WEB_scale', 'log'),
              scalarAttr('long_name', 'E_{K}'),
              intAttr('H5WEB_keep_ratio', 0),
            ],
          }),
          { scales: [['/view_hints/kappa'], [], []] },
        ),
        // Attribute values that fail to load (see `MockApi#getAttrValues`)
        ...['attr_error', 'attr_network_error'].map((name) =>
          array(name, {
            valueId: 'twoD',
            attributes: [scalarAttr('H5WEB_vis', 'line')],
          }),
        ),
        array('volume_iso', {
          valueId: 'threeD_fermi',
          attributes: [
            scalarAttr('H5WEB_vis', 'volume'),
            floatAttr('H5WEB_iso_levels', -1, 1),
          ],
        }),
        array('volume_plain', {
          valueId: 'threeD_fermi',
          attributes: [scalarAttr('H5WEB_vis', 'volume')],
        }),
        array('many_points', {
          attributes: [
            scalarAttr('H5WEB_geometry', 'points'),
            scalarAttr('H5WEB_color', 'red'),
          ],
        }),
        dataset(
          'huge_points', // 1.6 GB: never fetched for an overlay
          arrayShape([100_000_000, 2]),
          floatType(),
          () => {
            throw new Error('`huge_points` must not be fetched');
          },
          { attributes: [scalarAttr('H5WEB_geometry', 'points')] },
        ),
        array('point', {
          valueId: 'psi_point',
          attributes: [scalarAttr('H5WEB_geometry', 'points')],
        }),
        array('landscape_large', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('H5WEB_overlays', 'many_points huge_points point'),
          ],
        }),
        array('line_overlays', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            floatAttr('H5WEB_scale', 1), // wrong type: ignored with a note
            scalarAttr('H5WEB_overlays', 'point'),
          ],
        }),
        array('bad_attrs', {
          valueId: 'twoD',
          attributes: [
            intAttr('H5WEB_vis', 2),
            scalarAttr('H5WEB_keep_ratio', 'yes'),
          ],
        }),
        // Constant slice (e.g. ψ₀₀ ≡ 1 in a stack): finite colour domain all the same
        array('constant', {
          valueId: 'constant_twoD',
          attributes: [
            scalarAttr('H5WEB_scale', 'symlog'),
            scalarAttr('H5WEB_colormap', 'auto'),
          ],
        }),
        array('surface', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('H5WEB_vis', 'surface'),
            floatAttr('H5WEB_z_stretch', 0.8),
          ],
        }),
        withDimScales(
          array('line', {
            valueId: 'twoD',
            attributes: [
              scalarAttr('H5WEB_vis', 'line'),
              scalarAttr('H5WEB_scale', 'SymLog'),
              scalarAttr('H5WEB_x_dim', 'X'), // dimension scale name
              scalarAttr('H5WEB_multi_dim', 'series'), // or dimension label, or index
            ],
          }),
          { labels: ['series', ''], scales: [[], ['/dimension_scales/X']] },
        ),
        // Few curves along a dimension: legend of their scale values
        array('angle', {
          valueId: 'multi_angle',
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'angle'),
          ],
        }),
        withDimScales(
          array('line_curves', {
            valueId: 'multi_curves',
            attributes: [
              scalarAttr('H5WEB_vis', 'line'),
              scalarAttr('H5WEB_multi_dim', 'angle'),
            ],
          }),
          { scales: [['/view_hints/angle'], []] },
        ),
        withDimScales(
          array('line_nan_curves', {
            valueId: 'multi_nan_curves', // all-NaN middle curve
            attributes: [
              scalarAttr('H5WEB_vis', 'line'),
              scalarAttr('H5WEB_multi_dim', 'angle'),
            ],
          }),
          { scales: [['/view_hints/angle'], []] },
        ),
        // `H5WEB_value_transform`: values are logarithms, labelled as powers
        array('value_transform_line', {
          valueId: 'log10_error',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_value_transform', 'exp10'),
          ],
        }),
        array('value_transform_heatmap', {
          valueId: 'log10_twoD',
          attributes: [
            scalarAttr('H5WEB_value_transform', 'EXP2'),
            scalarAttr('H5WEB_nan_color', '#f0f'), // also −∞
            intAttr('H5WEB_keep_ratio', 0),
          ],
        }),
        // `H5WEB_envelope`: running min over the data, running max from the end instead of it
        array('envelope_add', {
          valueId: 'convergence',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'log'),
            scalarAttr('H5WEB_envelope', 'cummin'),
          ],
        }),
        array('envelope_replace', {
          valueId: 'convergence_twoD',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'log'),
            intAttr('H5WEB_multi_dim', 0),
            scalarAttr('H5WEB_envelope', 'cummax'),
            scalarAttr('H5WEB_envelope_mode', 'replace'),
            scalarAttr('H5WEB_envelope_direction', 'reverse'),
          ],
        }),
        // `H5WEB_series`: extra curves on the same axes, sliced along with the base dataset
        ...(['series_k', 'series_x'] as const).map((name) =>
          array(name, {
            attributes: [
              scalarAttr('CLASS', 'DIMENSION_SCALE'),
              scalarAttr('NAME', name.slice(7)),
            ],
          }),
        ),
        withDimScales(
          array('series_fit', {
            attributes: [
              scalarAttr('H5WEB_label', 'fit e^{-x/6}'),
              scalarAttr('H5WEB_color', 'hsl(0 80% 45%)'),
              floatAttr('H5WEB_width', 2),
            ],
          }),
          { scales: [['/view_hints/series_k'], ['/view_hints/series_x']] },
        ),
        array('series_bound', {
          attributes: [
            scalarAttr('long_name', 'bound'), // no scale: along x
            intAttr('H5WEB_dash', 1),
          ],
        }),
        withDimScales(
          array('series_data', {
            attributes: [
              scalarAttr('long_name', 'data'),
              scalarAttr('H5WEB_label', 'measured'), // of its own curve
              scalarAttr('H5WEB_color', '#eb6834'),
              scalarAttr('H5WEB_vis', 'line'),
              scalarAttr(
                'H5WEB_series',
                'series_fit series_bound sigma missing_series',
              ),
            ],
          }),
          { scales: [['/view_hints/series_k'], ['/view_hints/series_x']] },
        ),
        // Reference lines and bands of line views, listed as overlays
        scalar('tolerance', 1e-3, {
          attributes: [
            scalarAttr('H5WEB_geometry', 'hline'),
            scalarAttr('H5WEB_label', 'tolerance 10^{-3}'),
            scalarAttr('H5WEB_color', 'crimson'),
            intAttr('H5WEB_dash', 1),
          ],
        }),
        array('switch', {
          valueId: 'ref_vline', // (1,)
          attributes: [
            scalarAttr('H5WEB_geometry', 'vline'),
            scalarAttr('H5WEB_label', 'switch'),
          ],
        }),
        array('target', {
          valueId: 'ref_band_y',
          attributes: [
            scalarAttr('H5WEB_geometry', 'band'),
            scalarAttr('H5WEB_axis', 'y'),
            scalarAttr('H5WEB_label', 'target'),
            scalarAttr('H5WEB_color', 'green'),
          ],
        }),
        array('warmup', {
          valueId: 'ref_band_x',
          attributes: [
            scalarAttr('H5WEB_geometry', 'band'),
            scalarAttr('H5WEB_axis', 'x'),
          ],
        }),
        array('band_no_axis', {
          valueId: 'ref_band_x',
          attributes: [scalarAttr('H5WEB_geometry', 'band')],
        }),
        array('line_references', {
          valueId: 'convergence',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'log'),
            scalarAttr(
              'H5WEB_overlays',
              'warmup target tolerance switch band_no_axis point',
            ),
          ],
        }),
        // Values that can't be drawn in log scale: marked on the bottom edge, in `H5WEB_nan_color`
        array('line_zeros', {
          valueId: 'residual_zeros',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'log'),
            scalarAttr('H5WEB_nan_color', '#d9d9d9'),
          ],
        }),
        // Legend in the corner its box covers the least of the curves (not the bottom)
        array('legend_spectrum', {
          valueId: 'spectrum',
          attributes: [
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'log'),
            intAttr('H5WEB_multi_dim', 0),
          ],
        }),
        nxData('nx_overlay', {
          signal: array('signal', { valueId: 'twoD' }),
          attributes: [scalarAttr('H5WEB_overlays', '../point')],
        }),
        // Group attributes override the signal's, attribute by attribute
        nxData('nx_merged', {
          signal: array('signal', {
            valueId: 'twoD',
            attributes: [
              scalarAttr('H5WEB_vis', 'line'),
              scalarAttr('H5WEB_scale', 'log'),
            ],
          }),
          attributes: [scalarAttr('H5WEB_scale', 'symlog')],
        }),
        nxData('nx_line', {
          signal: array('signal', { valueId: 'twoD' }),
          attributes: [
            scalarAttr('SILX_style', '{"signal_scale_type": "log"}'),
            scalarAttr('H5WEB_vis', 'line'),
            scalarAttr('H5WEB_scale', 'symlog'),
          ],
        }),
        // netCDF-4: phony dimension scales (not variables) are neither axes nor links, so the
        // static overlay is drawn on every slice of the stack
        ...(['phony_5', 'phony_2'] as const).map((name, i) =>
          array(name, {
            valueId: i === 0 ? 'cma_generation' : 'psi_point',
            attributes: [
              scalarAttr('CLASS', 'DIMENSION_SCALE'),
              scalarAttr(
                'NAME',
                `This is a netCDF dimension but not a netCDF variable.  ${5 - 3 * i}`,
              ),
            ],
          }),
        ),
        withDimScales(
          array('phony_points', {
            valueId: 'cma_mean',
            attributes: [scalarAttr('H5WEB_geometry', 'points')],
          }),
          { scales: [['/view_hints/phony_5'], ['/view_hints/phony_2']] },
        ),
        withDimScales(
          array('phony_stack', {
            valueId: 'cma_landscapes',
            attributes: [
              scalarAttr('H5WEB_overlays', '/view_hints/phony_points'),
            ],
          }),
          { scales: [['/view_hints/phony_5'], [], []] },
        ),
        // CF `long_name` and `units`: title, colour bar / value axis, axis labels
        array('hyperangle', {
          valueId: 'X',
          attributes: [
            scalarAttr('long_name', 'α_{h} (hyperangle)'),
            scalarAttr('units', 'rad'),
          ],
        }),
        withDimScales(
          array('cf_heatmap', {
            valueId: 'twoD',
            attributes: [
              scalarAttr('long_name', 'E_{K}'), // no Unicode subscript K
              scalarAttr('units', 'hartree'),
              scalarAttr('H5WEB_vis', 'heatmap'),
            ],
          }),
          { scales: [[], ['/view_hints/hyperangle']] },
        ),
        withDimScales(
          array('cf_line', {
            valueId: 'oneD',
            attributes: [
              scalarAttr('H5WEB_title', 'growth'),
              scalarAttr('long_name', 'norm^{Green}'), // no Unicode superscript G
              scalarAttr('units', 'bohr'),
              scalarAttr('H5WEB_vis', 'line'),
            ],
          }),
          { scales: [['/view_hints/hyperangle']] },
        ),
        // CF labels without any `H5WEB_*` attribute
        array('cf_plain', {
          valueId: 'twoD',
          attributes: [
            scalarAttr('long_name', 'E_{k}'),
            scalarAttr('units', 'hartree'),
          ],
        }),
        // Overlay whose columns don't name the dimension on the y axis
        array('stack_point', {
          valueId: 'psi_point',
          attributes: [
            scalarAttr('H5WEB_geometry', 'points'),
            scalarAttr('H5WEB_columns', 'hyperangle generation'),
          ],
        }),
        withDimScales(
          array('stack_overlays', {
            valueId: 'cma_landscapes',
            attributes: [scalarAttr('H5WEB_overlays', 'stack_point')],
          }),
          {
            scales: [
              ['/view_hints/generation'],
              [],
              ['/view_hints/hyperangle'],
            ],
          },
        ),
        // Volume of a 4D dataset (leading dimension sliced), and of a 2D one (not available)
        array('volume_stack', {
          valueId: 'fourD',
          attributes: [
            scalarAttr('long_name', 'stack of volumes'),
            scalarAttr('H5WEB_vis', 'volume'),
          ],
        }),
        array('volume_flat', {
          valueId: 'twoD',
          attributes: [scalarAttr('H5WEB_vis', 'volume')],
        }),
        // Panels side by side: the same field twice, their difference and a line, linked and
        // sliced together along `generation` (`missing` is skipped with a note)
        group(
          'panels',
          [
            ...(
              [
                ['field', 'panels_field', 'ψ'],
                ['field_half', 'panels_field_half', 'ψ/2'],
              ] as const
            ).map(([name, valueId, longName]) =>
              withDimScales(
                array(name, {
                  valueId,
                  attributes: [
                    scalarAttr('long_name', longName),
                    scalarAttr('H5WEB_colormap', 'auto'),
                  ],
                }),
                {
                  scales: [
                    ['/view_hints/generation'],
                    ['/view_hints/theta'],
                    ['/view_hints/alpha'],
                  ],
                },
              ),
            ),
            withDimScales(
              array('difference', {
                valueId: 'panels_difference',
                attributes: [
                  scalarAttr('H5WEB_scale', 'log'),
                  scalarAttr('H5WEB_title', '|ψ − ψ/2|'),
                ],
              }),
              { scales: [['/view_hints/theta'], ['/view_hints/alpha']] },
            ),
            withDimScales(array('profile', { valueId: 'psi_axis' }), {
              scales: [['/view_hints/alpha']],
            }),
          ],
          {
            attributes: [
              scalarAttr(
                'H5WEB_panels',
                'field field_half difference profile missing',
              ),
              arrayAttr('H5WEB_layout', [2, 2], { type: intType(true, 32) }),
              intAttr('H5WEB_symmetric', 1),
            ],
          },
        ),
        // Small multiples of ψ_{k,p}: NaN where p > k (empty panels)
        array('k', {
          valueId: 'multiples_k',
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'k'),
          ],
        }),
        array('p', {
          valueId: 'multiples_p',
          attributes: [
            scalarAttr('CLASS', 'DIMENSION_SCALE'),
            scalarAttr('NAME', 'p'),
          ],
        }),
        ...(
          [
            ['multiples', 'k p', []],
            ['multiples_k', 'k', [intAttr('H5WEB_multiples_columns', 3)]],
          ] as const
        ).map(([name, dims, attributes]) =>
          withDimScales(
            array(name, {
              valueId: 'multiples',
              attributes: [
                scalarAttr('long_name', 'ψ_{k,p}'),
                scalarAttr('H5WEB_multiples_dim', dims),
                scalarAttr('H5WEB_colormap', 'auto'),
                intAttr('H5WEB_symmetric', 1),
                ...attributes,
              ],
            }),
            {
              scales: [
                ['/view_hints/k'],
                ['/view_hints/p'],
                ['/view_hints/theta'],
                ['/view_hints/alpha'],
              ],
            },
          ),
        ),
      ]),
      group('resilience', [
        scalar('error_value', 0, { attributes: [scalarAttr('attr', 1)] }),
        scalar('slow_value', 42),
        array('slow_slicing', { valueId: 'threeD' }),
        group('slow_metadata'),
        nxData('slow_nx_spectrum', {
          signal: withNxAttr(array('slow_twoD', { valueId: 'twoD' }), {
            interpretation: 'spectrum',
          }),
          errors: array('slow_twoD_errors', { valueId: 'twoD_errors' }),
          axes: { slow_X: array('slow_X', { valueId: 'X' }) },
          axesAttr: ['.', 'slow_X'],
          auxiliary: {
            slow_secondary: array('slow_secondary', { valueId: 'secondary' }),
          },
          auxAttr: ['slow_secondary'],
          title: scalar('title', 'NeXus 2D'),
        }),
        nxData('slow_nx_image', {
          signal: array('slow_threeD', { valueId: 'threeD' }),
          axes: {
            slow_X: array('slow_X', { valueId: 'X' }),
            slow_Y: array('slow_Y', { valueId: 'Y' }),
          },
          axesAttr: ['.', 'slow_Y', 'slow_X'],
          title: scalar('title', 'NeXus 2D'),
        }),
        dataset(
          'slow_large_twoD', // 2 GB - generate rows on demand
          arrayShape([10_000_000, 50]),
          floatType(),
          (selection?: string) => {
            const row = selection && /^(\d+),:$/u.exec(selection)?.[1];
            if (!row) {
              throw new Error('Only rows of `slow_large_twoD` can be fetched');
            }
            return Float32Array.from({ length: 50 }, (_, i) => Number(row) + i);
          },
        ),
      ]),
    ],
  });
}
