import { type ReactNode } from 'react';

import { getTextContent } from '../utils';
import styles from './VolumeVis.module.css';

interface Props {
  title: ReactNode;
  isoProgress: number | undefined;
  isoMessage: string | undefined;
}

/* Title and isosurface status over the canvas; rendered after the canvas to paint over it,
 * but without z-index so as to stay under toolbar popovers */
function CanvasOverlay(props: Props) {
  const { title, isoProgress, isoMessage } = props;

  return (
    <>
      {title && (
        <p
          className={styles.title}
          title={getTextContent(title)}
          data-keep-colors // white over canvas, even in inverted dark mode
        >
          {title}
        </p>
      )}
      {(isoProgress !== undefined || isoMessage) && (
        <div
          className={styles.overlay}
          data-below-title={!!title || undefined}
          data-keep-colors
        >
          {isoProgress !== undefined && (
            <p className={styles.progress} role="status">
              Extracting isosurfaces… {Math.round(isoProgress * 100)}%
            </p>
          )}
          {isoMessage && (
            <p className={styles.message} role="note">
              {isoMessage}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export default CanvasOverlay;
