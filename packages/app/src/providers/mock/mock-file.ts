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
          attributes: [scalarAttr('H5WEB_ticks', 'Pi')],
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
