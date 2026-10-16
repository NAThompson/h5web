import { type ArrayValue } from '@h5web/shared/hdf5-models';
import { type Domain } from '@h5web/shared/vis-models';

import { type ColorMap } from '../core/heatmap/models';
import { useDimScales } from '../dimscales/hooks';
import { type CursorStore } from './cursor';
import HeatmapPanel from './HeatmapPanel';
import LinePanel from './LinePanel';
import {
  type PanelDataset,
  type PanelSpec,
  type PanelVisOptions,
} from './models';
import OverlaidHeatmapPanel from './OverlaidHeatmapPanel';
import PanelCursor from './PanelCursor';

export interface PanelColors {
  domain: Domain; // shared by the panels of a group
  colorMap?: ColorMap;
}

export interface PanelProps {
  spec: PanelSpec;
  colors?: PanelColors; // shared colour domain, if any (else the panel's own, with a colour bar)
  cursorStore?: CursorStore; // linked cursor
  isCompact: boolean; // small panel: no overlay text, small markers, cursor values in a readout
  onDataDomainChange?: (key: string, domain: Domain | undefined) => void;
}

interface Props extends PanelProps {
  value: ArrayValue<PanelDataset['type']>;
}

/* Values of a panel as its kind of vis */
function PanelContent(props: Props) {
  const { spec, value, colors, cursorStore, isCompact, onDataDomainChange } =
    props;
  const { dataset, kind, key, linkKey } = spec;

  const axes = useDimScales(dataset);
  const panel: PanelVisOptions = {
    showColorBar: !colors,
    renderLayer:
      cursorStore &&
      ((data) => (
        <PanelCursor
          {...data}
          store={cursorStore}
          panelKey={key}
          panelTitle={spec.title}
          linkKey={linkKey}
          kind={kind}
          showValue={!isCompact}
        />
      )),
  };

  if (kind === 'line') {
    return <LinePanel spec={spec} value={value} axes={axes} panel={panel} />;
  }

  const heatmapProps = {
    spec,
    value,
    axes,
    colors,
    panel,
    onDataDomainChange,
  };
  return spec.hint.overlayPaths.length > 0 ? (
    <OverlaidHeatmapPanel {...heatmapProps} isCompact={isCompact} />
  ) : (
    <HeatmapPanel {...heatmapProps} />
  );
}

export default PanelContent;
