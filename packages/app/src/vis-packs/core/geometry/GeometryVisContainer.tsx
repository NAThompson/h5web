import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertNumericType,
} from '@h5web/shared/guards';
import { type ReactElement } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { type DefaultSlice } from '../../nexus/models';
import { useDatasetSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import VisBoundary from '../../VisBoundary';
import GeometryFetcher, { type GeometryData } from './GeometryFetcher';
import { useCachedGeometry } from './hooks';
import {
  type GeometryKind,
  getGeometryDefaultSlice,
  getGeometryDimsCount,
  guessGeometryDimsCount,
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

  /* Geometry was resolved (and cached) when the visualization was offered; read it without
   * suspending, as errors must be caught by the `VisBoundary` below. If it was evicted from the
   * cache, guess from attributes until `GeometryFetcher` resolves it again. */
  const geometry = useCachedGeometry(entity);
  const lockedDimsCount = geometry
    ? getGeometryDimsCount(geometry)
    : guessGeometryDimsCount(entity, kind);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 0,
    lockedDimsCount,
    defaultSlice: getGeometryDefaultSlice(defaultSlice, lockedDimsCount),
  });

  const selection = getSliceSelection(dimMapping);
  const hint = useViewHint(entity);
  const { dimHints, dimLabels } = useDimInfo(entity);
  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    { withPlaybackRange: true },
  );

  return (
    <>
      {selection !== undefined && ( // only when there are dimensions to slice
        <DimensionMapper
          className={visualizerStyles.dimMapper}
          dims={dims}
          dimHints={dimHints}
          dimLabels={dimLabels}
          dimMapping={dimMapping}
          {...slicingProps}
          onChange={setDimMapping}
        />
      )}
      <VisBoundary
        resetKey={dimMapping}
        isSlice={selection !== undefined}
        playbackRange={playbackRange}
      >
        <GeometryFetcher
          dataset={entity}
          kind={kind}
          selection={selection}
          render={(data) => render(data, hint.title ?? entity.name)}
        />
      </VisBoundary>
    </>
  );
}

export default GeometryVisContainer;
