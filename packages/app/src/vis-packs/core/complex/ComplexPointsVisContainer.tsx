import {
  assertArrayShape,
  assertComplexType,
  assertDataset,
} from '@h5web/shared/guards';

import { type VisContainerProps } from '../../models';
import { useViewHint } from '../../view-hints/hooks';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import MappedComplexPointsVis from './MappedComplexPointsVis';

/* 1D complex values as points of the complex plane (`H5WEB_vis = "complex_points"`) */
function ComplexPointsVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertComplexType(entity);

  const hint = useViewHint(entity);

  return (
    <VisBoundary>
      <ValueFetcher
        dataset={entity}
        render={(value) => (
          <MappedComplexPointsVis
            dataset={entity}
            value={value}
            hint={hint}
            title={hint.title ?? entity.name}
            toolbarContainer={toolbarContainer}
          />
        )}
      />
    </VisBoundary>
  );
}

export default ComplexPointsVisContainer;
