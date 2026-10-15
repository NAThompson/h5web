import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertPrintableType,
} from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useMatrixConfig } from './config';
import MappedMatrixVis from './MappedMatrixVis';

function MatrixVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertPrintableType(entity);

  const { dims } = entity.shape;
  const axesCount = Math.min(dims.length, 2);
  const [dimMapping, setDimMapping] = useDimMappingState({ dims, axesCount });

  const config = useMatrixConfig();
  const selection = getSliceSelection(dimMapping);

  const { slicingProps } = useDatasetSlicingProps(entity, dimMapping);
  const { dimHints, dimLabels } = useDimInfo(entity); // once resolved, e.g. by another vis

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimLabels={dimLabels}
        dimMapping={dimMapping}
        {...slicingProps}
        onChange={setDimMapping}
      />
      <VisBoundary resetKey={dimMapping} isSlice={selection !== undefined}>
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <MappedMatrixVis
              dataset={entity}
              value={value}
              dimMapping={dimMapping}
              toolbarContainer={toolbarContainer}
              config={config}
            />
          )}
        />
      </VisBoundary>
    </>
  );
}

export default MatrixVisContainer;
