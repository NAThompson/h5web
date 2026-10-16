import {
  DimensionMapper,
  type DimensionMapping,
  getSliceSelection,
} from '@h5web/lib';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDimMappingState, useSetDimMapping } from '../../dim-mapping-store';
import { useSelectPath } from '../../visualizer/navigation';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { useCachedDimScales, useDimInfo } from '../dimscales/hooks';
import { type VisContainerProps } from '../models';
import { useSlicingProps } from '../slicing';
import OverlayNotes from '../view-hints/OverlayNotes';
import { type ResolvedPanel, type ResolvedPanels } from './hint';
import { type PanelSpec } from './models';
import PanelGrid, { type PanelGridHandle } from './PanelGrid';
import PanelsToolbar, { type PanelsSettings } from './PanelsToolbar';
import {
  getGridSize,
  getPanelAxes,
  getPanelMapping,
  SNAPSHOT_MAX_PANELS,
} from './utils';

/* Panels with the same axes: same kind, and same dimension scales (or lengths) on the axes */
export function getLinkKey(
  panel: Pick<ResolvedPanel, 'kind' | 'dims' | 'scales'>,
  mapping: DimensionMapping,
): string {
  return [
    panel.kind,
    ...getPanelAxes(panel.kind).map((axis) => {
      const dim = mapping.indexOf(axis);
      return panel.scales[dim]?.[0] ?? `#${panel.dims[dim]}`;
    }),
  ].join('|');
}

/* Panel whose dimensions the sliders slice: the first with the most dimensions */
function findReference(panels: ResolvedPanel[]): ResolvedPanel {
  return panels.reduce((ref, panel) =>
    panel.dims.length > ref.dims.length ? panel : ref,
  );
}

/* Mapping of the reference's dimensions for a slicing selection (axes as in `mapping`) */
function toMapping(
  selection: string | undefined,
  mapping: DimensionMapping,
): DimensionMapping {
  const parts = selection?.split(',');
  return mapping.map((dim, i) =>
    typeof dim === 'number' && parts ? Number(parts[i]) : dim,
  );
}

interface Props extends VisContainerProps {
  resolved: ResolvedPanels;
}

/* Panels of a group, sliced together by the sliders of the panel with the most dimensions */
function GroupPanels(props: Props) {
  const { resolved, toolbarContainer } = props;
  const { hint, panels, notes } = resolved;

  const ref = findReference(panels);
  const [refMapping, setRefMapping] = useDimMappingState({
    dims: ref.dims,
    axesCount: getPanelAxes(ref.kind).length,
  });
  const { dimHints, dimLabels, sliceLabels } = useDimInfo(ref.dataset);

  const [settings, setSettings] = useState<PanelsSettings>({
    linkAxes: hint.linkAxes ?? true,
    linkCursor: hint.linkCursor ?? true,
    isDomainShared: hint.domain !== undefined,
  });

  const dimScales = useCachedDimScales(ref.dataset);

  const getMappings = useCallback(
    (mapping: DimensionMapping) =>
      panels.map((panel) =>
        panel === ref
          ? mapping
          : getPanelMapping(panel, panel.kind, ref, mapping),
      ),
    [panels, ref],
  );

  const [rows, cols] = getGridSize(panels.length, hint.layout);
  const specs = useMemo(() => {
    const mappings = getMappings(refMapping);
    return panels.map((panel, i): PanelSpec => {
      const { dataset, hint: panelHint, kind } = panel;
      return {
        key: dataset.path,
        dataset,
        hint: panelHint,
        kind,
        mapping: mappings[i],
        title: panelHint.title ?? dataset.name,
        row: Math.floor(i / cols),
        col: i % cols,
        linkKey: getLinkKey(panel, mappings[i]),
      };
    });
  }, [panels, refMapping, getMappings, cols]);

  // Linked panels all on the same axes: their labels once, beside the grid
  const isOneView =
    settings.linkAxes &&
    specs.every(({ linkKey }) => linkKey === specs[0].linkKey);
  const [xLabel, yLabel] = (['x', 'y'] as const).map(
    (axis) => dimScales[refMapping.indexOf(axis)]?.label,
  );
  const axisLabels = useMemo(
    () =>
      isOneView && (xLabel || yLabel) ? { x: xLabel, y: yLabel } : undefined,
    [isOneView, xLabel, yLabel],
  );

  // Sliders slice all panels: their values are fetched ahead of playback together
  const { slicingProps } = useSlicingProps(
    (selection) =>
      getMappings(toMapping(selection, refMapping)).map((mapping, i) => ({
        dataset: panels[i].dataset,
        selection: getSliceSelection(mapping),
      })),
    refMapping,
  );

  const selectPath = useSelectPath();
  const setDimMapping = useSetDimMapping();
  const onOpen = useCallback(
    (spec: PanelSpec) => {
      setDimMapping(
        spec.dataset.shape.dims,
        getPanelAxes(spec.kind).length,
        spec.mapping,
      );
      selectPath?.(spec.dataset.path);
    },
    [selectPath, setDimMapping],
  );

  const gridRef = useRef<PanelGridHandle>(null);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <PanelsToolbar
            settings={settings}
            withSharedDomain={panels.some(({ kind }) => kind === 'heatmap')}
            onChange={setSettings}
            onBeforeSnapshot={async () => gridRef.current?.prepareSnapshot()}
          />,
          toolbarContainer,
        )}
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={ref.dims}
        dimHints={dimHints}
        dimLabels={dimLabels}
        sliceLabels={sliceLabels}
        dimMapping={refMapping}
        {...slicingProps}
        onChange={setRefMapping}
      />
      <PanelGrid
        ref={gridRef}
        className={visualizerStyles.vis}
        specs={specs}
        rows={rows}
        cols={cols}
        isDomainShared={settings.isDomainShared}
        domainHint={hint.domain}
        centerHint={hint.center}
        linkAxes={settings.linkAxes}
        linkCursor={settings.linkCursor}
        edgeAxesOnly={false}
        axisLabels={axisLabels}
        onOpen={selectPath && onOpen}
      />
      <OverlayNotes
        notes={[
          ...notes,
          ...(specs.length > SNAPSHOT_MAX_PANELS
            ? [`snapshots load only the first ${SNAPSHOT_MAX_PANELS} panels`]
            : []),
          ...panels.flatMap(({ dataset, hint: panelHint }) =>
            panelHint.notes.map((note) => `${dataset.name}: ${note}`),
          ),
        ]}
      />
    </>
  );
}

export default GroupPanels;
