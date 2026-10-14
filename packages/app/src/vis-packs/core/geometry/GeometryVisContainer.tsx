import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertNumericType,
} from '@h5web/shared/guards';
import { type ReactElement } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import { useValuesInCache } from '../../../hooks';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useDimHints } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { type DefaultSlice } from '../../nexus/models';
import VisBoundary from '../../VisBoundary';
import GeometryFetcher, { type GeometryData } from './GeometryFetcher';
import {
  type GeometryKind,
  getGeometryDefaultSlice,
  getGeometryDimsCount,
} from './utils';

interface Props extends VisContainerProps {
  kind: GeometryKind;
  render: (data: GeometryData, title: string) => ReactElement;
  defaultSlice?: DefaultSlice; // NeXus `default_slice`
}

/* Trailing dimensions of the dataset make up the geometry and are locked;
 * leading dimensions, if any (e.g. time), can be sliced. */
function GeometryVisContainer(props: Props) {
  const { entity, kind, render, defaultSlice } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertNumericType(entity);

  const { dims } = entity.shape;
  const lockedDimsCount = getGeometryDimsCount(entity, kind);
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 0,
    lockedDimsCount,
    defaultSlice: getGeometryDefaultSlice(defaultSlice, lockedDimsCount),
  });

  const selection = getSliceSelection(dimMapping);
  const dimHints = useDimHints(entity);
  const canSliceFast = useValuesInCache(entity);

  return (
    <>
      {selection !== undefined && ( // only when there are dimensions to slice
        <DimensionMapper
          className={visualizerStyles.dimMapper}
          dims={dims}
          dimHints={dimHints}
          dimMapping={dimMapping}
          canSliceFast={canSliceFast}
          onChange={setDimMapping}
        />
      )}
      <VisBoundary resetKey={dimMapping} isSlice={selection !== undefined}>
        <GeometryFetcher
          dataset={entity}
          selection={selection}
          render={(data) => render(data, entity.name)}
        />
      </VisBoundary>
    </>
  );
}

export default GeometryVisContainer;
