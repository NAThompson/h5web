import { DimensionMapper } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertNumericLikeType,
} from '@h5web/shared/guards';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDimMappingState, useSetDimMapping } from '../../dim-mapping-store';
import { useSetActiveVis } from '../../visualizer/navigation';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { useCachedDimScales, useDimInfo } from '../dimscales/hooks';
import { type VisContainerProps } from '../models';
import { useSlicingProps } from '../slicing';
import {
  getOverlayLegend,
  useResolvedOverlays,
  useViewHint,
} from '../view-hints/hooks';
import OverlayLegend from '../view-hints/OverlayLegend';
import OverlayNotes from '../view-hints/OverlayNotes';
import { getPanelKind } from './hint';
import { type PanelSpec } from './models';
import PanelGrid, { type PanelGridHandle } from './PanelGrid';
import PanelsToolbar, { type PanelsSettings } from './PanelsToolbar';
import {
  formatIndexLabel,
  getGridSize,
  getMultiplesGrid,
  getPanelAxes,
  insertIndices,
  insertSelectionIndices,
  MAX_PANELS,
  SNAPSHOT_MAX_PANELS,
} from './utils';

/* Small multiples: a panel per index of one or two dimensions (`H5WEB_multiples_dim`; default:
 * the first), sliced alike along the others */
function MultiplesVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertNumericLikeType(entity);

  const { dims } = entity.shape;
  const hint = useViewHint(entity);
  const resolved = useResolvedOverlays(entity, hint); // shared with the panels (same query)
  const multiplesDims = useMemo(
    () => hint.multiplesDims ?? [0],
    [hint.multiplesDims],
  );
  const subDims = useMemo(
    () => dims.filter((_, d) => !multiplesDims.includes(d)),
    [dims, multiplesDims],
  );
  const { kind } = getPanelKind(hint, subDims);
  const axesCount = getPanelAxes(kind).length;

  const [subMapping, setSubMapping] = useDimMappingState({
    dims: subDims,
    axesCount,
  });

  const { dimHints, dimLabels, sliceLabels } = useDimInfo(entity);
  const dimScales = useCachedDimScales(entity);
  function withoutMultiples<T>(arr: T[]): T[] {
    return dims.flatMap((_, d) => (multiplesDims.includes(d) ? [] : [arr[d]]));
  }

  const [settings, setSettings] = useState<PanelsSettings>({
    linkAxes: hint.linkAxes ?? true,
    linkCursor: hint.linkCursor ?? true,
    isDomainShared: true,
  });

  const sizes = multiplesDims.map((d) => dims[d]);
  const count = sizes.reduce((acc, size) => acc * size, 1);
  const cols =
    sizes.length === 2
      ? sizes[1]
      : (hint.multiplesColumns ?? getGridSize(Math.min(count, MAX_PANELS))[1]);
  const cells = useMemo(
    () => getMultiplesGrid(sizes, cols, MAX_PANELS),
    [sizes.join(','), cols], // eslint-disable-line react-hooks/exhaustive-deps -- sizes of the dimensions
  );
  const rows = Math.ceil(cells.length / cols);

  const getIndexLabel = useCallback(
    (k: number, index: number) => {
      const dim = multiplesDims[k];
      const scale = dimScales[dim];
      return formatIndexLabel(
        dimLabels[dim] ?? `D${dim}`,
        index,
        scale?.value,
        scale?.sliceLabels,
      );
    },
    [multiplesDims, dimScales, dimLabels],
  );

  const specs = useMemo(
    () =>
      cells.map(({ indices, row, col }): PanelSpec => ({
        key: indices.join(','),
        dataset: entity,
        hint,
        kind,
        mapping: insertIndices(subMapping, multiplesDims, indices),
        title: indices.map((index, k) => getIndexLabel(k, index)).join(', '),
        row,
        col,
        linkKey: 'multiples',
      })),
    [cells, entity, hint, kind, subMapping, multiplesDims, getIndexLabel],
  );

  // Two dimensions: a facet grid, with the index of each row and column once, along its edges
  const headers = useMemo(
    () =>
      sizes.length === 2
        ? {
            rows: Array.from({ length: rows }, (_, i) => getIndexLabel(0, i)),
            cols: Array.from({ length: cols }, (_, i) => getIndexLabel(1, i)),
          }
        : undefined,
    [sizes.length, rows, cols, getIndexLabel],
  );

  // Labels of the axes, shared by all panels
  const xDim = specs.at(0)?.mapping.indexOf('x') ?? -1;
  const yDim = specs.at(0)?.mapping.indexOf('y') ?? -1;
  const axisLabels = useMemo(
    () => ({ x: dimScales[xDim]?.label, y: dimScales[yDim]?.label }),
    [dimScales, xDim, yDim],
  );

  // Sliders slice all panels: their values are fetched ahead of playback together
  const { slicingProps } = useSlicingProps(
    (selection) =>
      cells.map(({ indices }) => ({
        dataset: entity,
        selection: insertSelectionIndices(
          selection,
          subDims.length,
          multiplesDims,
          indices,
        ),
      })),
    subMapping,
    {
      playbackDefaults: hint.playback,
      playbackDim:
        hint.playbackDim === undefined ||
        multiplesDims.includes(hint.playbackDim)
          ? undefined
          : hint.playbackDim -
            multiplesDims.filter((d) => d < (hint.playbackDim ?? 0)).length,
    },
  );

  const setActiveVis = useSetActiveVis();
  const setDimMapping = useSetDimMapping();
  const onOpen = useCallback(
    (spec: PanelSpec) => {
      setDimMapping(dims, axesCount, spec.mapping);
      setActiveVis?.(kind === 'heatmap' ? 'Heatmap' : 'Line'); // names of the core vis
    },
    [dims, axesCount, kind, setActiveVis, setDimMapping],
  );

  const gridRef = useRef<PanelGridHandle>(null);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <PanelsToolbar
            settings={settings}
            withSharedDomain={kind === 'heatmap'}
            onChange={setSettings}
            onBeforeSnapshot={async () => gridRef.current?.prepareSnapshot()}
          />,
          toolbarContainer,
        )}
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={subDims}
        dimHints={withoutMultiples(dimHints)}
        dimLabels={withoutMultiples(dimLabels)}
        sliceLabels={withoutMultiples(sliceLabels)}
        dimMapping={subMapping}
        {...slicingProps}
        onChange={setSubMapping}
      />
      <PanelGrid
        ref={gridRef}
        name={entity.name}
        className={visualizerStyles.vis}
        specs={specs}
        rows={rows}
        cols={cols}
        isDomainShared={settings.isDomainShared && kind === 'heatmap'}
        linkAxes={settings.linkAxes}
        linkCursor={settings.linkCursor}
        edgeAxesOnly
        axisLabels={axisLabels}
        headers={headers}
        footer={
          <OverlayLegend
            items={getOverlayLegend(hint, resolved?.overlays ?? [])}
            inline
          />
        }
        onOpen={setActiveVis && onOpen}
      />
      <OverlayNotes
        notes={[
          ...hint.notes,
          ...(count > MAX_PANELS
            ? [`only the first ${MAX_PANELS} of ${count} panels`]
            : []),
          ...(specs.length > SNAPSHOT_MAX_PANELS
            ? [`snapshots load only the first ${SNAPSHOT_MAX_PANELS} panels`]
            : []),
        ]}
      />
    </>
  );
}

export default MultiplesVisContainer;
