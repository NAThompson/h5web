import { SnapshotBtn, ToggleBtn, Toolbar } from '@h5web/lib';
import { MdCenterFocusWeak, MdLink, MdPalette } from 'react-icons/md';

import { useVisArea } from '../../visualizer/vis-area';
import { INTERACTIONS_WITH_AXIAL_ZOOM } from '../core/utils';

export interface PanelsSettings {
  linkAxes: boolean;
  linkCursor: boolean;
  isDomainShared: boolean;
}

interface Props {
  settings: PanelsSettings;
  withSharedDomain: boolean; // heatmap panels
  onChange: (settings: PanelsSettings) => void;
}

function PanelsToolbar(props: Props) {
  const { settings, withSharedDomain, onChange } = props;
  const { linkAxes, linkCursor, isDomainShared } = settings;
  const visArea = useVisArea();

  return (
    <Toolbar interactions={INTERACTIONS_WITH_AXIAL_ZOOM}>
      {withSharedDomain && (
        <ToggleBtn
          label="Shared domain"
          Icon={MdPalette}
          value={isDomainShared}
          onToggle={() =>
            onChange({ ...settings, isDomainShared: !isDomainShared })
          }
        />
      )}
      <ToggleBtn
        label="Link axes"
        Icon={MdLink}
        value={linkAxes}
        onToggle={() => onChange({ ...settings, linkAxes: !linkAxes })}
      />
      <ToggleBtn
        label="Link cursor"
        Icon={MdCenterFocusWeak}
        value={linkCursor}
        onToggle={() => onChange({ ...settings, linkCursor: !linkCursor })}
      />
      {visArea && <SnapshotBtn target={visArea} />}
    </Toolbar>
  );
}

export default PanelsToolbar;
