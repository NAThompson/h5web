import styles from './VolumeVis.module.css';

interface Props {
  title: string | undefined;
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
        <p className={styles.title} title={title}>
          {title}
        </p>
      )}
      {(isoProgress !== undefined || isoMessage) && (
        <div className={styles.overlay} data-below-title={!!title || undefined}>
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
