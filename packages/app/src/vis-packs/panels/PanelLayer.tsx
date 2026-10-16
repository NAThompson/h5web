import { type ReactElement } from 'react';

import { type PanelLayerData, type PanelVisOptions } from './models';

interface Props {
  panel: PanelVisOptions | undefined;
  data: PanelLayerData;
  children?: ReactElement; // when not a panel (e.g. `KeepZoom`)
}

/* What a vis draws over its data as a panel (e.g. linked cursor), else as a single view */
function PanelLayer(props: Props): ReactElement | null {
  const { panel, data, children } = props;
  return (panel ? panel.renderLayer?.(data) : children) ?? null;
}

export default PanelLayer;
