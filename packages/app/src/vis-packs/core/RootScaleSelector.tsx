import { ScaleSelector } from '@h5web/lib';
import { ScaleType } from '@h5web/shared/vis-models';

import styles from './heatmap/HeightScaleSlider.module.css';
import { type ColorOrRootScaleType, ROOT_SCALE_TYPES } from './utils';

// Half steps: n = 2.5 sits between square and cube roots; beyond 10, roots barely differ
const MIN = 2;
const MAX = 10;

const OPTION_LABELS = { [ScaleType.Gamma]: 'Root' };

interface Props {
  value: ColorOrRootScaleType;
  onScaleChange: (scaleType: ColorOrRootScaleType) => void;
  rootN: number;
  onRootNChange: (rootN: number) => void;
}

/* Colour scale selector with the nth root (gamma of exponent 1/n), and a slider over n */
function RootScaleSelector(props: Props) {
  const { value, onScaleChange, rootN, onRootNChange } = props;

  return (
    <>
      <ScaleSelector
        value={value}
        onScaleChange={onScaleChange}
        options={ROOT_SCALE_TYPES}
        optionLabels={OPTION_LABELS}
      />
      {value === ScaleType.Gamma && (
        // A hinted n out of range widens the slider
        <label className={styles.root}>
          <span className={styles.label}>ⁿ√</span>
          <input
            className={styles.input}
            type="range"
            aria-label="Root degree"
            min={Math.min(MIN, rootN)}
            max={Math.max(MAX, rootN)}
            step={0.5}
            value={rootN}
            onChange={(evt) => onRootNChange(evt.currentTarget.valueAsNumber)}
          />
          <span className={styles.value}>
            {`n = ${Number(rootN.toPrecision(3))}`}
          </span>
        </label>
      )}
    </>
  );
}

export default RootScaleSelector;
