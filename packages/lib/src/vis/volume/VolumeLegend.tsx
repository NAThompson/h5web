import {
  type ColorScaleType,
  type Domain,
  ScaleType,
} from '@h5web/shared/vis-models';

import ColorBar from '../heatmap/ColorBar';
import { type ColorMap } from '../heatmap/models';
import styles from './VolumeVis.module.css';

interface Props {
  domain: Domain;
  scaleType: ColorScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showVolume: boolean;
  gradientDomain: Domain | undefined;
  gradientLabel: string | undefined;
  isoProgress: number | undefined;
  isoMessage: string | undefined;
}

/* Colour bars of the volume and/or of gradient magnitudes on isosurfaces, and extraction progress */
function VolumeLegend(props: Props) {
  const {
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    showVolume,
    gradientDomain,
    gradientLabel = '|∇f|',
    isoProgress,
    isoMessage,
  } = props;

  return (
    <>
      {(isoProgress !== undefined || isoMessage) && (
        <div className={styles.overlay}>
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
      {(showVolume || !gradientDomain) && (
        <ColorBar
          domain={domain}
          scaleType={scaleType}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
          withBounds
        />
      )}
      {gradientDomain && (
        <div className={styles.gradientBar} aria-label="Gradient magnitude">
          <p className={styles.gradientLabel}>{gradientLabel}</p>
          <ColorBar
            domain={gradientDomain}
            scaleType={ScaleType.Linear}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            withBounds
          />
        </div>
      )}
    </>
  );
}

export default VolumeLegend;
