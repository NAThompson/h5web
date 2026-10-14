import {
  type ColorScaleType,
  type Domain,
  IsoColorMode,
  Popover,
  ToggleGroup,
} from '@h5web/lib';
import { MdAdd, MdLayers } from 'react-icons/md';

import { type IsoLevel } from './config';
import IsoLevelRow from './IsoLevelRow';
import styles from './IsosurfacesControl.module.css';
import { getDefaultIsoValue, getSliderScale, roundLevel } from './utils';

interface Props {
  levels: IsoLevel[];
  domain: Domain;
  scaleType: ColorScaleType;
  colorMode: IsoColorMode;
  step: number;
  onAdd: (value: number) => void;
  onUpdate: (id: number, update: Partial<Omit<IsoLevel, 'id'>>) => void;
  onRemove: (id: number) => void;
  onColorModeChange: (colorMode: IsoColorMode) => void;
}

function IsosurfacesControl(props: Props) {
  const {
    levels,
    domain,
    scaleType,
    colorMode,
    step,
    onAdd,
    onUpdate,
    onRemove,
    onColorModeChange,
  } = props;

  const sliderScale = getSliderScale(domain, scaleType);

  return (
    <Popover
      label="Isosurfaces"
      btnLabel={
        levels.length > 0 ? `Isosurfaces (${levels.length})` : 'Isosurfaces'
      }
      Icon={MdLayers}
    >
      <div className={styles.header}>
        <span className={styles.label}>Colour</span>
        <ToggleGroup
          role="radiogroup"
          ariaLabel="Isosurface colour"
          value={colorMode}
          onChange={(val) => onColorModeChange(val as IsoColorMode)}
        >
          <ToggleGroup.Btn
            label="Solid"
            value={IsoColorMode.Solid}
            hint="One colour per level"
          />
          <ToggleGroup.Btn
            label="|∇f|"
            value={IsoColorMode.Gradient}
            hint="Gradient magnitude, with the colour map"
          />
        </ToggleGroup>
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
