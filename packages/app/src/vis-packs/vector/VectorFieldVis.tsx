import {
  DimensionMapper,
  getSliceSelection,
  VectorBackground,
} from '@h5web/lib';

import { useDimMappingState } from '../../dim-mapping-store';
import { type ValueQueryParams } from '../../providers/models';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { guessKeepRatio } from '../core/utils';
import { useDimInfo } from '../dimscales/hooks';
import LargeValueGuard from '../LargeValueGuard';
import { type VisContainerProps } from '../models';
import { useSlicingProps } from '../slicing';
import { useViewHint } from '../view-hints/hooks';
import OverlayNotes from '../view-hints/OverlayNotes';
import { getRootScaleNotes } from '../view-hints/utils';
import VisBoundary from '../VisBoundary';
import { useVectorConfig } from './config';
import FieldFetcher from './FieldFetcher';
import MappedVectorVis from './MappedVectorVis';
import { getSpatialLabels, useResolvedVector } from './utils';

function VectorFieldVis(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  const {
    source,
    hint: vectorHint,
    background,
    units,
  } = useResolvedVector(entity);
  const { rank } = source;
  const isDatasetForm = source.kind === 'dataset';
  const base = isDatasetForm ? source.dataset : source.components[0];
  const { dims } = base.shape;

  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 0,
    lockedDimsCount: rank + (isDatasetForm ? 1 : 0),
  });
  const selection = getSliceSelection(dimMapping);

  // Background dataset: on the grid of the field (with its leading dimensions)
  const gridDims = isDatasetForm ? dims.slice(0, -1) : dims;
  const isOnGrid =
    !!background && background.shape.dims.join(',') === gridDims.join(',');

  const hint = useViewHint(entity);
  const { dimHints, dimLabels, sliceLabels, dimUnits } = useDimInfo(base);
  const config = useVectorConfig(
    {
      ...hint,
      keepRatio:
        hint.keepRatio ??
        guessKeepRatio(
          { unit: dimUnits.at(isDatasetForm ? -2 : -1) },
          { unit: dimUnits.at(isDatasetForm ? -3 : -2) },
        ),
    },
    // Unusable background dataset (noted): magnitude
    isOnGrid || vectorHint.background !== VectorBackground.Dataset
      ? vectorHint
      : { ...vectorHint, background: undefined },
  );

  const notes = [
    ...hint.notes,
    ...getRootScaleNotes(hint),
    ...vectorHint.notes,
    ...(background && !isOnGrid
      ? ['"H5WEB_vector_background" is not on the grid of the field']
      : []),
  ];

  function getRequests(sel: string | undefined): ValueQueryParams[] {
    return source.kind === 'dataset'
      ? [{ dataset: source.dataset, selection: sel }]
      : source.components.map((dataset) => ({ dataset, selection: sel }));
  }
  function getBackgroundRequests(sel: string | undefined): ValueQueryParams[] {
    return background && isOnGrid
      ? [
          {
            dataset: background,
            selection: isDatasetForm ? sel?.replace(/,:$/u, '') : sel,
          },
        ]
      : [];
  }

  const { slicingProps, playbackRange } = useSlicingProps(
    getRequests,
    dimMapping,
    {
      withPlaybackRange: true,
      getExtraRequests: getBackgroundRequests,
      playbackDefaults: hint.playback,
      playbackDim: hint.playbackDim,
    },
  );

  const requests = [
    ...getRequests(selection),
    ...getBackgroundRequests(selection),
  ];

  return (
    <>
      {selection !== undefined && (
        <DimensionMapper
          className={visualizerStyles.dimMapper}
          dims={dims}
          dimHints={dimHints}
          dimLabels={dimLabels}
          sliceLabels={sliceLabels}
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
        <LargeValueGuard requests={requests}>
          <FieldFetcher
            source={source}
            requests={requests}
            hasBackground={isOnGrid}
            render={(field, bg, axisLabels) => (
              <MappedVectorVis
                field={field}
                background={bg}
                backgroundName={background?.name}
                title={hint.title ?? entity.name}
                units={units}
                labels={getSpatialLabels(axisLabels, dims, isDatasetForm)}
                config={config}
                toolbarContainer={toolbarContainer}
                isDatasetForm={isDatasetForm}
              />
            )}
          />
        </LargeValueGuard>
      </VisBoundary>
      <OverlayNotes notes={notes} />
    </>
  );
}

export default VectorFieldVis;
