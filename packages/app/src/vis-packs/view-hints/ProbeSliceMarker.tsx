import { DataToHtml, Html, useVisCanvasContext } from '@h5web/lib';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import styles from './ViewHints.module.css';

/* Current slice on the probe's line: vertical line and point */
function ProbeSliceMarker(props: { x: number; y: number }) {
  const { x, y } = props;
  const { canvasSize } = useVisCanvasContext();
  const points = useMemo(
    (): [Vector3] => [new Vector3(x, Number.isFinite(y) ? y : 0)],
    [x, y],
  );

  return (
    <DataToHtml points={points}>
      {(pt) => (
        <Html>
          <svg
            className={styles.svg}
            data-testid="probe-slice"
            data-keep-colors
          >
            <line
              x1={pt.x}
              x2={pt.x}
              y1={0}
              y2={canvasSize.height}
              stroke="#e66101"
              strokeDasharray="4 3"
            />
            {Number.isFinite(y) && (
              <circle cx={pt.x} cy={pt.y} r={4} fill="#e66101" />
            )}
          </svg>
        </Html>
      )}
    </DataToHtml>
  );
}

export default ProbeSliceMarker;
