import { type PaletteName, PALETTES, Selector, ToggleBtn } from '@h5web/lib';
import { MdCategory } from 'react-icons/md';

import { CATEGORICAL_PALETTES } from './categorical';
import styles from './CategoricalControl.module.css';

const SWATCH_COUNT = 10;

interface Props {
  value: boolean;
  onToggle: () => void;
  palette: PaletteName;
  onPaletteChange: (palette: PaletteName) => void;
}

/* Categorical colors on / off, and their palette when on (in place of the color map) */
function CategoricalControl(props: Props) {
  const { value, onToggle, palette, onPaletteChange } = props;

  return (
    <>
      <ToggleBtn
        label="Categorical"
        aria-label="Categorical colors"
        Icon={MdCategory}
        value={value}
        onToggle={onToggle}
      />
      {value && (
        <Selector
          label="Palette"
          value={palette}
          onChange={onPaletteChange}
          options={CATEGORICAL_PALETTES}
          renderOption={(option) => (
            <div className={styles.option}>
              {option}
              <span className={styles.swatches} data-keep-colors>
                {PALETTES[option].slice(0, SWATCH_COUNT).map((color) => (
                  <span key={color} style={{ backgroundColor: color }} />
                ))}
              </span>
            </div>
          )}
        />
      )}
    </>
  );
}

export default CategoricalControl;
