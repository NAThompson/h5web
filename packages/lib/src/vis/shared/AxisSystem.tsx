import { createPortal } from 'react-dom';

import { useCameraState } from '../hooks';
import { type AxisOffsets } from '../models';
import Axis from './Axis';
import Html from './Html';
import { useVisCanvasContext } from './VisCanvasProvider';

interface Props {
  axisOffsets: AxisOffsets;
  showAxes: boolean;
  axes?: { x: boolean; y: boolean }; // which axes are shown, e.g. of a panel
}

function AxisSystem(props: Props) {
  const { axisOffsets, showAxes, axes } = props;
  const {
    canvasSize,
    visCanvas,
    abscissaConfig,
    ordinateConfig,
    getVisibleDomains,
  } = useVisCanvasContext();

  const visibleDomains = useCameraState(getVisibleDomains, [getVisibleDomains]);

  return (
    <Html>
      {createPortal(
        <>
          <Axis
            type="abscissa"
            config={abscissaConfig}
            domain={visibleDomains.xVisibleDomain}
            canvasSize={canvasSize}
            offset={axisOffsets.bottom}
            showAxis={showAxes && (axes?.x ?? true)}
          />
          <Axis
            type="ordinate"
            config={ordinateConfig}
            domain={visibleDomains.yVisibleDomain}
            canvasSize={canvasSize}
            offset={axisOffsets.left}
            showAxis={showAxes && (axes?.y ?? true)}
            flipAxis
          />
        </>,
        visCanvas,
      )}
    </Html>
  );
}

export default AxisSystem;
