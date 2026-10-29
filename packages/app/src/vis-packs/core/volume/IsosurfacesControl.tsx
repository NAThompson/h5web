import { type Domain, IsoColorMode, Popover, ToggleGroup } from '@h5web/lib';
import { MdAdd, MdLayers } from 'react-icons/md';

import { type ColorOrRootScaleType } from '../utils';
import { type IsoLevel } from './config';
import IsoLevelRow from './IsoLevelRow';
import styles from './IsosurfacesControl.module.css';
import { getDefaultIsoValue, getSliderScale, roundLevel } from './utils';

interface Props {
  levels: IsoLevel[];
  domain: Domain;
  scaleType: ColorOrRootScaleType;
  colorMode: IsoColorMode;
  step: number;
  smooth: boolean | undefined; // `undefined`: grid too large
  onAdd: (value: number) => void;
  onUpdate: (id: number, update: Partial<Omit<IsoLevel, 'id'>>) => void;
  onRemove: (id: number) => void;
  onColorModeChange: (colorMode: IsoColorMode) => void;
  onSmoothChange: (smooth: boolean) => void;
}

function IsosurfacesControl(props: Props) {
  const {
    levels,
    domain,
    scaleType,
    colorMode,
    step,
    smooth,
    onAdd,
    onUpdate,
    onRemove,
    onColorModeChange,
    onSmoothChange,
  } = props;

  const sliderScale = getSliderScale(domain, scaleType);

  return (
    <Popover
      label="Isosurfaces" // constant width: a wider button would move to the overflow menu and close
      Icon={MdLayers}
    >
      <div className={styles.header}>
        <span className={styles.label}>Color</span>
        <ToggleGroup
          role="radiogroup"
          ariaLabel="Isosurface color"
          value={colorMode}
          onChange={(val) => onColorModeChange(val as IsoColorMode)}
        >
          <ToggleGroup.Btn
            label="Solid"
            value={IsoColorMode.Solid}
            hint="One color per level"
          />
          <ToggleGroup.Btn
            label="|∇𝑓|"
            value={IsoColorMode.Gradient}
            hint="Gradient magnitude, with the color map"
          />
        </ToggleGroup>
        <label title="Surfaces (and pass region) follow a cubic spline through the data, not straight lines between grid points">
          <input
            type="checkbox"
            aria-label="Smooth surfaces"
            checked={!!smooth}
            disabled={smooth === undefined}
            onChange={() => onSmoothChange(!smooth)}
          />{' '}
          Smooth
        </label>
      </div>

      {levels.length > 0 && (
        <ul className={styles.levels}>
          {levels.map((level, index) => (
            <IsoLevelRow
              key={level.id}
              level={level}
              index={index + 1}
              sliderPosition={sliderScale(level.value)}
              withColor={colorMode === IsoColorMode.Solid}
              onSliderChange={(pos) =>
                onUpdate(level.id, {
                  value: roundLevel(sliderScale.invert(pos)),
                })
              }
              onUpdate={(update) => onUpdate(level.id, update)}
              onRemove={() => onRemove(level.id)}
            />
          ))}
        </ul>
      )}

      <button
        className={styles.addBtn}
        type="button"
        onClick={() => onAdd(getDefaultIsoValue(domain, scaleType))}
      >
        <MdAdd aria-hidden /> Add level
      </button>

      {smooth === undefined && (
        <p className={styles.note}>
          Smooth surfaces disabled above 128³ grid cells
        </p>
      )}

      {step > 1 && (
        <p className={styles.note}>
          Large volume: surfaces extracted on every {step}
          <sup>{step === 2 ? 'nd' : step === 3 ? 'rd' : 'th'}</sup> grid point
        </p>
      )}
    </Popover>
  );
}

export default IsosurfacesControl;
