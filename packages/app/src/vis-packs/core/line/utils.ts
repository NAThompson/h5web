import {
  type AuxiliaryParams,
  type AxisParams,
  getCombinedDomain,
  getSplineDomain,
  type VisScaleType,
} from '@h5web/lib';
import {
  type DimensionMapping,
  type Domain,
  type IgnoreValue,
  type NumArray,
} from '@h5web/shared/vis-models';
import { formatTick } from '@h5web/shared/vis-utils';
import ndarray, { type NdArray } from 'ndarray';

// Map multi-plotting dimension to `y` axis so that all its slices are fetched at once and become the rows of a 2D array
export function getMultiPlotMapping(
  dimMapping: DimensionMapping,
  multiDim: number | undefined,
): DimensionMapping {
  if (multiDim === undefined) {
    return dimMapping;
  }

  return dimMapping.map((val, i) => (i === multiDim ? 'y' : val));
}

// Label slice of multi-plotting dimension with its dimension scale value when available
// (e.g. HDF5 dimension scale, NeXus axis), or with its index otherwise
export function getMultiPlotSliceLabel(
  dim: number,
  index: number,
  axisLabel: string | undefined,
  axisValues: NumArray | undefined,
  sliceLabels?: string[], // e.g. `H5WEB_slice_labels`: label alone
): string {
  if (sliceLabels?.[index] !== undefined) {
    return sliceLabels[index];
  }

  const scaleValue = axisValues?.[index];
  if (scaleValue === undefined) {
    return `D${dim}[${index}]`;
  }

  return `${axisLabel ?? `D${dim}`}: ${formatTick(scaleValue)}`;
}

// Split 2D array into its rows without copying (mapped arrays are contiguous)
export function getRows(array: NdArray<NumArray>): NdArray<NumArray>[] {
  const { data, shape } = array;
  const [rowCount, rowLength] = shape;

  return Array.from({ length: rowCount }, (_, i) => {
    const start = i * rowLength;
    const end = start + rowLength;
    return ndarray(
      Array.isArray(data) ? data.slice(start, end) : data.subarray(start, end),
    );
  });
}

/* Range of the cubic splines of the curves drawn, overshoot included (curves without
 * their own `ignoreValue` use the dataset's, as in `LineVis`) */
export function getSplinesDomain(
  abscissas: NumArray,
  curves: Pick<AuxiliaryParams, 'array' | 'visible' | 'ignoreValue'>[],
  ignoreValue: IgnoreValue | undefined,
  xScaleType: VisScaleType | undefined,
  yScaleType: VisScaleType | undefined,
): Domain | undefined {
  return getCombinedDomain(
    curves
      .filter(({ visible }) => visible !== false)
      .map(({ array, ignoreValue: ignore }) =>
        getSplineDomain(
          abscissas,
          array.data,
          xScaleType,
          yScaleType,
          ignore ?? ignoreValue,
        ),
      ),
  );
}

export function generateCsv(
  name: string,
  dataArray: NdArray<NumArray>,
  abscissaParams: AxisParams,
  errorsArray: NdArray<NumArray> | undefined,
  auxiliaries: (AuxiliaryParams & { label: string })[], // required label
): string {
  let csv = '';

  // Column headers
  csv += abscissaParams.label?.replaceAll(',', '') || 'x';
  csv += `,${name.replaceAll(',', '')}`;
  csv += errorsArray ? `,errors` : '';

  for (const aux of auxiliaries) {
    const auxLabel = aux.label.replaceAll(',', '');
    csv += `,${auxLabel}`;
    csv += aux.errors ? `,${auxLabel}_errors` : '';
  }

  // Column values
  for (let i = 0; i < dataArray.shape[0]; i += 1) {
    csv += csv.length > 0 ? '\n' : '';

    csv += (abscissaParams.value ? abscissaParams.value[i] : i).toString();
    csv += `,${dataArray.get(i).toString()}`;
    csv += errorsArray ? `,${errorsArray.get(i).toString()}` : '';

    for (const aux of auxiliaries) {
      csv += `,${aux.array.get(i).toString()}`;
      csv += aux.errors ? `,${aux.errors.get(i).toString()}` : '';
    }
  }

  return csv;
}
