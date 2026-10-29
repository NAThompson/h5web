import { type Domain, Popover } from '@h5web/lib';
import { MdOutlineFactCheck } from 'react-icons/md';

import { type ColorOrRootScaleType } from '../utils';
import { type PassRegion } from './config';
import styles from './IsosurfacesControl.module.css';
import LevelInput from './LevelInput';
import { getDefaultIsoValue, getSliderScale, roundLevel } from './utils';

interface Props {
  region: PassRegion;
  domain: Domain;
  scaleType: ColorOrRootScaleType;
  onChange: (region: PassRegion) => void;
}

/* Region of the volume within optional bounds, e.g. where a spec passes */
function PassRegionControl(props: Props) {
  const { region, domain, scaleType, onChange } = props;
  const { enabled, min, max, color, invert } = region;

  const sliderScale = getSliderScale(domain, scaleType);
  const defaultValue = getDefaultIsoValue(domain, scaleType);

  function update(changes: Partial<PassRegion>): void {
    const next = { ...region, ...changes };
    // Shown without bounds: start from the middle of the domain; last bound removed: hidden
    const isUnbounded = next.min === null && next.max === null;
    onChange(
      isUnbounded && changes.enabled
        ? { ...next, min: defaultValue }
        : isUnbounded
          ? { ...next, enabled: false }
          : next,
    );
  }

  return (
    <Popover label="Pass region" Icon={MdOutlineFactCheck}>
      <div className={styles.header}>
        <label>
          <input
            type="checkbox"
            aria-label="Show region"
            checked={enabled}
            onChange={() => update({ enabled: !enabled })}
          />{' '}
          Show region
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Show failing part"
            checked={invert}
            onChange={() => update({ invert: !invert })}
          />{' '}
          Failing part
        </label>
        <input
          className={styles.colorInput}
          type="color"
          aria-label="Region color"
          value={color}
          onChange={(evt) => update({ color: evt.currentTarget.value })}
        />
      </div>
      <ul className={styles.levels}>
        {(['min', 'max'] as const).map((bound) => {
          const label = bound === 'min' ? 'Min' : 'Max';
          const value = region[bound];
          return (
            <li key={bound} className={styles.level}>
              <input
                type="checkbox"
                aria-label={`Use ${bound} bound`}
                checked={value !== null}
                onChange={() =>
                  value === null
                    ? update({ [bound]: defaultValue, enabled: true })
                    : update({ [bound]: null })
                }
              />
              <span className={styles.label}>{label}</span>
              <LevelInput
                value={value}
                sliderPosition={value === null ? 0 : sliderScale(value)}
                label={`${label} bound`}
                sliderLabel={`${label} bound slider`}
                onChange={(newValue) =>
                  update({ [bound]: newValue, enabled: true })
                }
                onSliderChange={(pos) =>
                  update({
                    [bound]: roundLevel(sliderScale.invert(pos)),
                    enabled: true,
                  })
                }
              />
            </li>
          );
        })}
      </ul>
      {enabled && min !== null && max !== null && min > max && (
        <p className={styles.note}>Min is above max: nothing passes</p>
      )}
    </Popover>
  );
}

export default PassRegionControl;
