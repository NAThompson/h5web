import { type Domain, ScaleType } from '@h5web/shared/vis-models';

import ColorBar from '../heatmap/ColorBar';
import { type ColorMap } from '../heatmap/models';
import { type VisScaleType } from '../models';
import styles from './VolumeVis.module.css';

interface Props {
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showVolume: boolean;
  gradientDomain: Domain | undefined;
  gradientLabel: string | undefined;
}

/* Colour bars of the volume and/or of gradient magnitudes on isosurfaces */
function VolumeLegend(props: Props) {
  const {
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    showVolume,
    gradientDomain,
    gradientLabel = '|∇f|',
  } = props;

  return (
    <>
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
