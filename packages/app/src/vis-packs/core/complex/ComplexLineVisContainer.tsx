import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertComplexType,
  assertDataset,
} from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import { useValuesInCache } from '../../../hooks';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimHints } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import VisBoundary from '../../VisBoundary';
import { useLineConfig } from '../line/config';
import ValueFetcher from '../ValueFetcher';
import MappedComplexLineVis from './MappedComplexLineVis';

function ComplexLineVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertComplexType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 1,
  });

  const config = useLineConfig();
  const selection = getSliceSelection(dimMapping);

  const dimHints = useDimHints(entity);

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimMapping={dimMapping}
        canSliceFast={useValuesInCache(entity)}
        onChange={setDimMapping}
      />
      <VisBoundary resetKey={dimMapping} isSlice={selection !== undefined}>
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <DimScalesFetcher
              dataset={entity}
              render={({ axisLabels, axisValues }) => (
                <MappedComplexLineVis
                  value={value}
                  dims={dims}
                  dimMapping={dimMapping}
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

export default ComplexLineVisContainer;
