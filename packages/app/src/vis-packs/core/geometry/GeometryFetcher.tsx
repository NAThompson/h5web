import { type IgnoreValue } from '@h5web/lib';
import { type ArrayValue, type NumericType } from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { type ReactNode, useMemo } from 'react';

import { useValue, useValues } from '../../../hooks';
import LargeValueGuard from '../../LargeValueGuard';
import { useIgnoreValues, usePackings } from '../../netcdf/hooks';
import { type Packing, unpackNumArray } from '../../netcdf/utils';
import { toNumArray } from '../utils';
import { splitVertices, toCoordinateArray, useGeometry } from './hooks';
import {
  type CoordinatesGeometry,
  type GeometryKind,
  type NumDataset,
  type VertexGeometry,
} from './utils';

export interface GeometryData {
  x: NumArray;
  y: NumArray;
  z: NumArray | undefined; // `vertex` curves may be planar
  values: NumArray | undefined; // scalar field; `undefined` for `vertex` curves
  shape: number[]; // `[N]` for curves, `[rows, cols]` for surfaces
  labels: [string | undefined, string | undefined, string | undefined];
  ignoreValue: IgnoreValue | undefined; // invalid values of the field (NetCDF)
  packing: Packing | undefined; // packing of the field (NetCDF), e.g. to unpack other slices
}

interface Props {
  dataset: NumDataset;
  kind: GeometryKind;
  selection: string | undefined; // slice of leading dimensions, if any
  render: (data: GeometryData) => ReactNode;
}

/* Resolve geometry of dataset, then fetch its coordinates and scalar field
 * (render within a `VisBoundary`) */
function GeometryFetcher(props: Props): ReactNode {
  const { dataset, kind, selection, render } = props;
  const geometry = useGeometry(dataset);
  if (geometry.kind !== kind) {
    throw new Error(`Expected dataset to describe a ${kind}`);
  }

  if (geometry.source === 'vertex') {
    return (
      <LargeValueGuard requests={[{ dataset: geometry.vertices, selection }]}>
        <VertexValues
          geometry={geometry}
          selection={selection}
          render={render}
        />
      </LargeValueGuard>
    );
  }

  return (
    <LargeValueGuard
      requests={[
        { dataset: geometry.field, selection },
        ...geometry.coords
          .filter((coord) => coord !== undefined)
          .map((coord) => ({ dataset: coord.dataset })),
      ]}
    >
      <CoordinatesValues
        geometry={geometry}
        selection={selection}
        render={render}
      />
    </LargeValueGuard>
  );
}

function VertexValues(props: {
  geometry: VertexGeometry;
  selection: string | undefined;
  render: (data: GeometryData) => ReactNode;
}): ReactNode {
  const { geometry, selection, render } = props;
  const { vertices, unit } = geometry;

  const value = useValue(vertices, selection);
  const [packing] = usePackings([vertices]);
  const [ignoreValue] = useIgnoreValues([vertices]);

  const data = useMemo((): GeometryData => {
    const { dims } = vertices.shape;
    const vertexDims = dims[dims.length - 1];
    const [x, y, z] = splitVertices(
      toCoordinateArray(value, packing, ignoreValue),
      vertexDims,
    ) as [NumArray, NumArray, NumArray | undefined];
    const suffix = unit ? ` (${unit})` : '';

    return {
      x,
      y,
      z,
      values: undefined,
      shape: [dims[dims.length - 2]],
      labels: [`x${suffix}`, `y${suffix}`, z ? `z${suffix}` : undefined],
      ignoreValue: undefined,
      packing: undefined,
    };
  }, [vertices, value, packing, ignoreValue, unit]);

  return render(data);
}

function CoordinatesValues(props: {
  geometry: CoordinatesGeometry;
  selection: string | undefined;
  render: (data: GeometryData) => ReactNode;
}): ReactNode {
  const { geometry, selection, render } = props;
  const { field, coords } = geometry;
  const [xDef, yDef, zDef] = coords;

  const {
    field: fieldValue,
    x: xValue,
    y: yValue,
    z: zValue,
  } = useValues({
    field: { dataset: field, selection },
    x: xDef.dataset,
    y: yDef.dataset,
    ...(zDef && { z: zDef.dataset }), // planar curve from dimension scales
  }) as Record<
    'field' | 'x' | 'y' | 'z',
    ArrayValue<NumericType> | undefined
  > & {
    field: ArrayValue<NumericType>;
    x: ArrayValue<NumericType>;
    y: ArrayValue<NumericType>;
  };

  const datasets = [field, xDef.dataset, yDef.dataset, zDef?.dataset];
  const [fieldPacking, xPacking, yPacking, zPacking] = usePackings(datasets);
  const [fieldIgnoreValue, xIgnoreValue, yIgnoreValue, zIgnoreValue] =
    useIgnoreValues(datasets);

  // Memoise each array separately, so changing slice doesn't rebuild coordinates
  const x = useMemo(
    () => toCoordinateArray(xValue, xPacking, xIgnoreValue),
    [xValue, xPacking, xIgnoreValue],
  );
  const y = useMemo(
    () => toCoordinateArray(yValue, yPacking, yIgnoreValue),
    [yValue, yPacking, yIgnoreValue],
  );
  const z = useMemo(
    () => zValue && toCoordinateArray(zValue, zPacking, zIgnoreValue),
    [zValue, zPacking, zIgnoreValue],
  );
  const values = useMemo(
    () => toNumArray(unpackNumArray(fieldValue, fieldPacking)),
    [fieldValue, fieldPacking],
  );

  const data = useMemo(
    (): GeometryData => ({
      x,
      y,
      z,
      values,
      shape: xDef.dataset.shape.dims,
      labels: [xDef.label, yDef.label, zDef?.label],
      ignoreValue: fieldIgnoreValue,
      packing: fieldPacking,
    }),
    [x, y, z, values, fieldIgnoreValue, fieldPacking, xDef, yDef, zDef],
  );

  return render(data);
}

export default GeometryFetcher;
