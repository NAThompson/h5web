import {
  Html,
  type KnotVector,
  useCameraState,
  useVisCanvasContext,
} from '@h5web/lib';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import styles from './NurbsBasis.module.css';

interface Props {
  vector: KnotVector;
}

/* Dotted line at each distinct knot of the domain, labelled with its multiplicity if repeated */
function NurbsKnotMarks(props: Props) {
  const { vector } = props;
  const { canvasSize, abscissaScale, worldToHtml } = useVisCanvasContext();

  const marks = useMemo(() => {
    const { degree, knots } = vector;
    const [start, end] = [knots[degree], knots[knots.length - degree - 1]];
    const distinct: { value: number; count: number }[] = [];
    knots.forEach((value) => {
      const last = distinct.at(-1);
      if (last?.value === value) {
        last.count += 1;
      } else if (value >= start && value <= end) {
        distinct.push({ value, count: 1 });
      }
    });
    return distinct;
  }, [vector]);

  const positions = useCameraState(
    (camera) =>
      marks.map(
        ({ value }) =>
          worldToHtml(camera, new Vector3(abscissaScale(value), 0)).x,
      ),
    [marks, abscissaScale, worldToHtml],
  );

  return (
    <Html overflowCanvas>
      <svg className={styles.knotSvg} data-testid="knots" data-keep-colors>
        {marks.map(({ value, count }, i) => {
          const isLast = i === marks.length - 1; // label on its left, within the canvas
          return (
            <g key={value}>
              <line
                className={styles.knotLine}
                x1={positions[i]}
                x2={positions[i]}
                y1={0}
                y2={canvasSize.height}
              />
              {count > 1 && (
                <text
                  className={styles.knotLabel}
                  x={positions[i] + (isLast ? -4 : 4)}
                  y={14}
                  textAnchor={isLast ? 'end' : 'start'}
                >
                  {`×${count}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Html>
  );
}

export default NurbsKnotMarks;
