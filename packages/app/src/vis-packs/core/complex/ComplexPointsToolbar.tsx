import { Menu, Separator, SnapshotBtn, ToggleBtn, Toolbar } from '@h5web/lib';
import { MdAspectRatio, MdBubbleChart, MdGridOn } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import LogSlider from '../scatter/LogSlider';
import { BASE_INTERACTIONS } from '../utils';
import { type ComplexPointsConfig } from './points-config';

interface Props {
  config: ComplexPointsConfig;
}

/* Toolbar of the complex plane (`H5WEB_vis = "complex_points"`) */
function ComplexPointsToolbar(props: Props) {
  const { config } = props;
  const visArea = useVisArea();
  const { keepRatio, showGrid, sizeScale } = config;
  const { setKeepRatio, setShowGrid, setSizeScale } = config;

  return (
    <Toolbar interactions={BASE_INTERACTIONS}>
      <ToggleBtn
        label="Keep ratio"
        Icon={MdAspectRatio}
        value={keepRatio}
        onToggle={() => setKeepRatio(!keepRatio)}
      />
      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />
      <Menu label="Points" Icon={MdBubbleChart}>
        <LogSlider
          label="Size"
          value={sizeScale}
          min={0.25}
          max={4}
          unit="times"
          onChange={setSizeScale}
        />
      </Menu>
      <Separator />

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default ComplexPointsToolbar;
