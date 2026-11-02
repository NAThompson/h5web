import {
  Checkbox,
  Menu,
  MenuSeparator,
  Separator,
  useCssColors,
} from '@h5web/lib';
import { createPortal } from 'react-dom';
import { MdLineAxis } from 'react-icons/md';

import styles from './NxLineSignalPicker.module.css';

interface Props {
  signalLabel: string;
  signalChecked: boolean;
  auxLabels: string[];
  auxChecked: boolean[];
  auxGroupLabel?: string;
  signalColor?: string; // of the curves, if not the default ones
  auxColors?: (string | undefined)[];
  auxOffset?: number; // of the first auxiliary curve among those of `LineVis`
  onSignalChange: (newValue: boolean) => void;
  onAuxChange: (newValue: boolean[]) => void;
  toolbarContainer: HTMLDivElement | undefined;
}

function NxLineSignalPicker(props: Props) {
  const {
    signalLabel,
    signalChecked,
    auxLabels,
    auxChecked,
    auxGroupLabel = 'Auxiliary signals',
    signalColor,
    auxColors,
    auxOffset = 0,
    onSignalChange,
    onAuxChange,
    toolbarContainer,
  } = props;

  // Same colors as the curves in `LineVis`
  const [[curveColor, auxColorList], rootRef] = useCssColors([
    '--curve-color',
    '--aux-colors',
  ]);
  const palette = auxColorList.split(',').map((col) => col.trim());

  if (!toolbarContainer) {
    return null;
  }

  const someAuxChecked = auxChecked.some(Boolean);
  const allAuxChecked = auxChecked.every(Boolean);

  return createPortal(
    <div ref={rootRef} className={styles.wrapper}>
      <Separator />

      <Menu label="Signals" Icon={MdLineAxis}>
        <Checkbox
          label={signalLabel}
          color={signalColor ?? curveColor}
          checked={signalChecked}
          onChange={onSignalChange}
        />

        <MenuSeparator />
        <Checkbox
          className={styles.allAuxOption}
          label={auxGroupLabel}
          color="gray" // not a curve's color
          checked={allAuxChecked}
          indeterminate={someAuxChecked && !allAuxChecked}
          onChange={() => {
            onAuxChange(auxChecked.map(() => !allAuxChecked));
          }}
        />

        {auxLabels.map((label, index) => {
          return (
            <Checkbox
              key={index} // labels may repeat
              label={label}
              color={
                auxColors?.[index] ??
                palette[(index + auxOffset) % palette.length]
              }
              checked={auxChecked[index]}
              onChange={(checked) => {
                const newValue = [...auxChecked];
                newValue[index] = checked;
                onAuxChange(newValue);
              }}
            />
          );
        })}
      </Menu>
    </div>,
    toolbarContainer,
  );
}

export default NxLineSignalPicker;
