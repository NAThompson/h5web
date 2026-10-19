import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useTooltip } from '@visx/tooltip';
import { useContext, useMemo } from 'react';

import { VisPanelContext } from '../shared/multi-canvas';
import Tooltip from '../shared/Tooltip';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import VisMesh from '../shared/VisMesh';
import PointTooltip, { type PointChannel } from './PointTooltip';
import { buildPointGrid, findNearestPoint, getMaxSize } from './utils';

const MIN_PICK_RADIUS = 4; // CSS pixels

interface Props {
  positions: Float32Array; // in the unit square
  sizes: Float32Array;
  sizeScale: number;
  channels: PointChannel[];
}

/** Tooltip with the index and values of the point under the cursor, if any. */
function PointPicker2D(props: Props) {
  const { positions, sizes, sizeScale, channels } = props;
  const { visSize } = useVisCanvasContext();
  const { tooltip: isEnabled = true } = useContext(VisPanelContext);
  const camera = useThree((state) => state.camera);

  const grid = useMemo(() => buildPointGrid(positions), [positions]);
  const maxSize = useMemo(() => getMaxSize(sizes), [sizes]);

  const {
    tooltipOpen,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    showTooltip,
    hideTooltip,
  } = useTooltip<number>();

  function handlePointerMove(evt: ThreeEvent<PointerEvent>) {
    const { unprojectedPoint, nativeEvent } = evt;
    if (nativeEvent.buttons !== 0) {
      return; // dragging
    }

    const { width, height } = visSize;
    const index = findNearestPoint(
      grid,
      positions,
      [unprojectedPoint.x / width + 0.5, unprojectedPoint.y / height + 0.5],
      [width / camera.scale.x, height / camera.scale.y],
      { sizes, sizeScale, minRadius: MIN_PICK_RADIUS, maxSize },
    );

    if (index === undefined) {
      hideTooltip();
    } else {
      showTooltip({
        tooltipData: index,
        tooltipLeft: nativeEvent.offsetX,
        tooltipTop: nativeEvent.offsetY,
      });
    }
  }

  if (!isEnabled) {
    return null;
  }

  return (
    <>
      <VisMesh
        onPointerMove={handlePointerMove}
        onPointerOut={() => hideTooltip()}
        onPointerDown={() => hideTooltip()}
      >
        <meshBasicMaterial opacity={0} transparent depthWrite={false} />
      </VisMesh>
      <Tooltip show={tooltipOpen} left={tooltipLeft} top={tooltipTop}>
        {tooltipData !== undefined && (
          <PointTooltip index={tooltipData} channels={channels} />
        )}
      </Tooltip>
    </>
  );
}

export default PointPicker2D;
