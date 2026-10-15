import {
  CurveType,
  type DimensionMapping,
  LineVis,
  useDomain,
} from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import ndarray from 'ndarray';
import { useMemo } from 'react';
import { MdClose } from 'react-icons/md';

import { useDataContext } from '../../providers/DataProvider';
import { toNumArray } from '../core/utils';
import { useCachedDimScales } from '../dimscales/hooks';
import { type DimScale } from '../dimscales/utils';
import { useIgnoreValue, usePacking } from '../netcdf/hooks';
import { unpackNumArray } from '../netcdf/utils';
import { isAffordable } from './hooks';
import { getProbeSelection, type ProbePoint } from './probe';
import ProbeSliceMarker from './ProbeSliceMarker';
import styles from './ViewHints.module.css';

/* Axis label of a dimension, as on the heatmap (e.g. from its scale's CF `long_name` and units) */
function getDimLabel(scale: DimScale | undefined, dim: number): string {
  return scale?.label ?? `D${dim}`;
}

/* Value of a dimension's scale at an index (the index without scale) */
function getDimValue(scale: DimScale | undefined, index: number): number {
  const value = scale?.value?.[index];
  return value === undefined ? index : Number(value);
}

interface Props {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  dimMapping: DimensionMapping;
  probeDim: number;
  point: ProbePoint;
  valueLabel?: string; // value axis, as on line views (CF `units` and `long_name`)
  onProbeDimChange: (dim: number) => void;
  onClose: () => void;
}

/* Values of a probed pixel of a stack along a sliced dimension (other sliced dimensions at
 * their current index), with the current slice marked; only this 1D selection is fetched */
function ProbePanel(props: Props) {
  const { dataset, dimMapping, probeDim, point, valueLabel } = props;
  const { onProbeDimChange, onClose } = props;
  const dataContext = useDataContext();
  const { queries } = dataContext;
  const packing = usePacking(dataset); // in cache since the heatmap is shown
  const ignoreValue = useIgnoreValue(dataset); // e.g. `_FillValue`, masked as on the heatmap
  const scales = useCachedDimScales(dataset);

  const selection = getProbeSelection(dimMapping, probeDim, point);
  const isTooLarge = !isAffordable(dataContext, { dataset, selection }); // e.g. a very long dimension
  const { data, error } = useQuery({
    ...queries.value(dataset, selection),
    enabled: selection !== undefined && !isTooLarge,
    placeholderData: keepPreviousData,
  });
  const values = useMemo(
    () =>
      data === undefined
        ? undefined
        : toNumArray(
            unpackNumArray(data as ArrayValue<NumericLikeType>, packing),
          ),
    [data, packing],
  );
  const domain = useDomain(values ?? [], { ignoreValue });

  const scale = scales[probeDim];
  const xLabel = getDimLabel(scale, probeDim);
  const index = dimMapping[probeDim];
  const current =
    typeof index === 'number' && values && index < values.length
      ? { x: getDimValue(scale, index), y: values[index] }
      : undefined;

  const slicedDims = dimMapping.flatMap((dim, i) =>
    typeof dim === 'number' ? [i] : [],
  );
  const position = Object.entries(point)
    .map(([dim, idx = 0]) => {
      const dimScale = scales[Number(dim)];
      return `${getDimLabel(dimScale, Number(dim))} = ${formatTooltipVal(getDimValue(dimScale, idx))}`;
    })
    .join(', ');

  return (
    <section className={styles.probe} aria-label="Probe">
      <header className={styles.probeHeader}>
        <span className={styles.probeTitle}>Probe at {position}</span>
        {slicedDims.length > 1 && (
          <select
            aria-label="Probe dimension"
            value={probeDim}
            onChange={(evt) => onProbeDimChange(Number(evt.target.value))}
          >
            {slicedDims.map((dim) => (
              <option key={dim} value={dim}>
                {getDimLabel(scales[dim], dim)}
              </option>
            ))}
          </select>
        )}
        <output className={styles.probeValue} aria-label="Probed value">
          {current &&
            `${xLabel} = ${formatTooltipVal(current.x)}: ${formatTooltipVal(current.y)}`}
        </output>
        <button
          className={styles.probeClose}
          type="button"
          aria-label="Close probe"
          onClick={onClose}
        >
          <MdClose />
        </button>
      </header>

      {isTooLarge ? (
        <p className={styles.probeError}>Values are too large to fetch</p>
      ) : error ? (
        <p className={styles.probeError}>Values could not be loaded</p>
      ) : (
        values && (
          <LineVis
            className={styles.probeVis}
            dataArray={ndarray(values)}
            curveType={CurveType.LineAndGlyphs} // stacks may have only a few slices
            domain={domain}
            abscissaParams={{
              label: xLabel,
              value: scale?.value && toNumArray(scale.value),
              ticks: scale?.ticks,
            }}
            ordinateLabel={valueLabel ?? dataset.name}
            ignoreValue={ignoreValue}
          >
            {current && <ProbeSliceMarker x={current.x} y={current.y} />}
          </LineVis>
        )
      )}
    </section>
  );
}

export default ProbePanel;
