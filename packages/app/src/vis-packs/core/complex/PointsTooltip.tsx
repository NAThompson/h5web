import { TooltipMesh, useVisCanvasContext } from '@h5web/lib';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';

import { renderMarkup } from '../../view-hints/markup';
import { type OverlayPoints } from '../../view-hints/overlays';

const PICK_DISTANCE = 10; // px: tooltip of the point under the pointer

function formatComplex(re: number, im: number): string {
  const sign = im < 0 ? '−' : '+';
  return `${formatTooltipVal(re)} ${sign} ${formatTooltipVal(Math.abs(im))}i`;
}

interface Props {
  points: OverlayPoints[];
}

/* Point nearest to the pointer, within a few pixels, with its value; coincident points drawn as
 * one are listed with their own values */
function PointsTooltip(props: Props) {
  const { points } = props;
  const { dataToHtml } = useVisCanvasContext();
  const camera = useThree((state) => state.camera);

  function renderTooltip(x: number, y: number) {
    // Pixels per data unit along each axis (linear axes): points are compared in data space
    const cursor = dataToHtml(camera, new Vector3(x, y));
    const unit = dataToHtml(camera, new Vector3(x + 1, y + 1));
    const [sx, sy] = [Math.abs(unit.x - cursor.x), Math.abs(unit.y - cursor.y)];

    let nearest: { set: OverlayPoints; j: number } | undefined;
    let best = PICK_DISTANCE;
    for (const set of points) {
      for (const [j, px] of set.x.entries()) {
        const dist = Math.hypot((px - x) * sx, (set.y[j] - y) * sy);
        if (dist <= best) {
          [best, nearest] = [dist, { set, j }];
        }
      }
    }

    if (!nearest) {
      return `ℜ = ${formatTooltipVal(x)}, ℑ = ${formatTooltipVal(y)}`;
    }
    const { set, j } = nearest;
    const merged = set.merged?.[j] ?? [[set.x[j], set.y[j]]];
    return (
      <>
        {set.label && renderMarkup(set.label)}
        {merged.length > 1 && ` (×${merged.length})`}
        {merged.map(([re, im], k) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={k}>
            <strong>{formatComplex(re, im)}</strong>
          </div>
        ))}
      </>
    );
  }

  return <TooltipMesh renderTooltip={renderTooltip} />;
}

export default PointsTooltip;
