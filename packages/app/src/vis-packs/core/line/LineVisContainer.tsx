import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertNumericLikeType,
} from '@h5web/shared/guards';
import { useMemo } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import { useValuesInCache } from '../../../hooks';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimHints } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useSlicePrefetcher } from '../../prefetch';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useLineConfig } from './config';
import MappedLineVis from './MappedLineVis';
import { getMultiPlotMapping } from './utils';

function LineVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertNumericLikeType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping, multiDim, setMultiDim] = useDimMappingState(
    { dims, axesCount: 1 },
  );

  const lineMapping = useMemo(
    () => getMultiPlotMapping(dimMapping, multiDim),
    [dimMapping, multiDim],
  );

  const config = useLineConfig();
  const selection = getSliceSelection(lineMapping);
  const isCached = useValuesInCache(entity);
  const prefetch = useSlicePrefetcher(entity);

  const dimHints = useDimHints(entity);

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimMapping={dimMapping}
        canSliceFast={(m) => isCached(getMultiPlotMapping(m, multiDim))}
        withPlaybackControls
        prefetchSlices={(ms) => {
          prefetch(ms.map((m) => getMultiPlotMapping(m, multiDim)));
        }}
        onChange={setDimMapping}
        multiDim={multiDim}
        onMultiDimChange={setMultiDim}
      />
      <VisBoundary resetKey={lineMapping} isSlice={selection !== undefined}>
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <DimScalesFetcher
              dataset={entity}
              render={({ axisLabels, axisValues }) => (
                <MappedLineVis
                  dataset={entity}
                  value={value}
                  dimMapping={lineMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  title={entity.name}
                  toolbarContainer={toolbarContainer}
                  config={config}
                />
              )}
            />
          )}
        />
      </VisBoundary>
    </>
  );
}

export default LineVisContainer;
