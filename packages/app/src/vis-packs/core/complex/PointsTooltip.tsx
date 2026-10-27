import { TooltipMesh, useVisCanvasContext } from '@h5web/lib';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';

import { renderMarkup } from '../../view-hints/markup';
import { type OverlayPoints } from '../../view-hints/overlays';

const PICK_DISTANCE = 10; // px: tooltip of the point under the pointer

/* Point nearest to the pointer, within a few pixels, with its value and multiplicity */
interface Props {
  points: OverlayPoints[];
}

function PointsTooltip(props: Props) {
  const { points } = props;
  const { dataToHtml } = useVisCanvasContext();
  const camera = useThree((state) => state.camera);

  function renderTooltip(x: number, y: number) {
    const cursor = dataToHtml(camera, new Vector3(x, y));
    let nearest: { set: OverlayPoints; j: number } | undefined;
    let best = PICK_DISTANCE;
    for (const set of points) {
      for (const [j, px] of set.x.entries()) {
        const pt = dataToHtml(camera, new Vector3(px, set.y[j]));
        const dist = Math.hypot(pt.x - cursor.x, pt.y - cursor.y);
        if (dist <= best) {
          [best, nearest] = [dist, { set, j }];
        }
      }
    }

    if (!nearest) {
      return `ℜ = ${formatTooltipVal(x)}, ℑ = ${formatTooltipVal(y)}`;
    }
    const { set, j } = nearest;
    const count = set.counts?.[j] ?? 1;
    return (
      <>
        {set.label && renderMarkup(set.label)}
        <div>
          <strong>
            {`${formatTooltipVal(set.x[j])} ${set.y[j] < 0 ? '−' : '+'} ${formatTooltipVal(Math.abs(set.y[j]))}i`}
          </strong>
          {count > 1 && ` (×${count})`}
        </div>
      </>
    );
  }

  return <TooltipMesh renderTooltip={renderTooltip} />;
}

export default PointsTooltip;
