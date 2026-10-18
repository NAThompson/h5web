import { Html, useCameraState, useVisCanvasContext } from '@h5web/lib';
import { Vector3 } from 'three';

import { type ReferenceShape } from './references';
import styles from './ViewHints.module.css';

const BAND_OPACITY = 0.2;
const DASH = '6 4';

interface Props {
  shapes: ReferenceShape[];
}

/* Reference lines and shaded bands on a line view, across the whole canvas */
function ReferenceLayer(props: Props) {
  const { shapes } = props;
  const { canvasSize, abscissaScale, ordinateScale, worldToHtml } =
    useVisCanvasContext();
  const { width, height } = canvasSize;

  // HTML coordinate of each value along its axis (`NaN` if it can't be shown, e.g. 0 in log)
  const positions = useCameraState(
    (camera) =>
      shapes.map(({ axis, values }) =>
        values.map((val) =>
          axis === 'x'
            ? worldToHtml(camera, new Vector3(abscissaScale(val), 0)).x
            : worldToHtml(camera, new Vector3(0, ordinateScale(val))).y,
        ),
      ),
    [shapes, abscissaScale, ordinateScale, worldToHtml],
  );

  return (
    <Html overflowCanvas>
      <svg
        className={styles.referenceSvg}
        data-testid="references"
        data-keep-colors
      >
        {shapes.map(
          ({ kind, axis, color, width: lineWidth, dash, label }, i) => {
            const [a, b] = positions[i];
            const title = label && <title>{label}</title>;
            if (
              !Number.isFinite(a) ||
              (kind === 'band' && !Number.isFinite(b))
            ) {
              return null;
            }
            if (kind === 'band') {
              const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
              return (
                <rect
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  data-kind={kind}
                  fill={color}
                  fillOpacity={BAND_OPACITY}
                  {...(axis === 'x'
                    ? { x: lo, y: 0, width: hi - lo, height }
                    : { x: 0, y: lo, width, height: hi - lo })}
                >
                  {title}
                </rect>
              );
            }
            return (
              <line
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                data-kind={kind}
                stroke={color}
                strokeWidth={lineWidth}
                strokeDasharray={dash ? DASH : undefined}
                {...(axis === 'x'
                  ? { x1: a, x2: a, y1: 0, y2: height }
                  : { x1: 0, x2: width, y1: a, y2: a })}
              >
                {title}
              </line>
            );
          },
        )}
      </svg>
    </Html>
  );
}

export default ReferenceLayer;
