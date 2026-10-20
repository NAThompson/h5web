import { ScaleSelector } from '@h5web/lib';
import { COLOR_SCALE_TYPES, ScaleType } from '@h5web/shared/vis-models';

import LabelledRange from './LabelledRange';
import {
  type ColorOrRootScaleType,
  ROOT_N_RANGE,
  ROOT_SCALE_TYPES,
} from './utils';

const OPTION_LABELS = { [ScaleType.Gamma]: 'Root' };

interface Props {
  value: ColorOrRootScaleType;
  onScaleChange: (scaleType: ColorOrRootScaleType) => void;
  withRoot?: boolean; // e.g. not for heights of complex surfaces
  options?: ColorOrRootScaleType[]; // e.g. only those of brightness
  rootN: number;
  onRootNChange: (rootN: number) => void;
}

/* Colour scale selector with the nth root (gamma of exponent 1/n), and a slider over n (n of hints
 * is snapped to its grid, so that the thumb and the label agree) */
function RootScaleSelector(props: Props) {
  const { value, onScaleChange, withRoot = true, rootN, onRootNChange } = props;
  const { options = withRoot ? ROOT_SCALE_TYPES : COLOR_SCALE_TYPES } = props;

  return (
    <>
      <ScaleSelector
        value={value}
        onScaleChange={onScaleChange}
        options={options}
        optionLabels={OPTION_LABELS}
      />
      {value === ScaleType.Gamma && (
        <LabelledRange
          label="ⁿ√"
          ariaLabel="Root degree"
          {...ROOT_N_RANGE}
          value={rootN}
          format={(n) => `n = ${n.toPrecision(3)}`}
          onChange={onRootNChange}
        />
      )}
    </>
  );
}

export default RootScaleSelector;
