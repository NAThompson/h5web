import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertCompoundType,
  assertDataset,
  assertNonNullShape,
  assertPrintableCompoundType,
} from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import VisBoundary from '../../VisBoundary';
import { useMatrixConfig } from '../matrix/config';
import ValueFetcher from '../ValueFetcher';
import MappedCompoundVis from './MappedCompoundVis';

function CompoundVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertNonNullShape(entity);
  assertCompoundType(entity);
  assertPrintableCompoundType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 1,
  });

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
      <VisBoundary isSlice={selection !== undefined}>
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <MappedCompoundVis
              dataset={entity}
              value={value}
              toolbarContainer={toolbarContainer}
              dimMapping={dimMapping}
              config={config}
            />
          )}
        />
      </VisBoundary>
    </>
  );
}

export default CompoundVisContainer;
