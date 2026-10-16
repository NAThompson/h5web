import { Checkbox, parseLevels, Popover, ToggleGroup } from '@h5web/lib';
import { formatInputVal, formatTooltipVal } from '@h5web/shared/vis-utils';
import { useState } from 'react';
import { MdTerrain } from 'react-icons/md';

import styles from './ContoursControl.module.css';
import { ContourColorMode, ContourMode } from './models';

const MAX_COUNT = 50;

interface Props {
  mode: ContourMode;
  count: number;
  customLevels: number[];
  autoLevels: number[];
  colorMode: ContourColorMode;
  color: string;
  showLabels: boolean;
  emphasis: number[];
  onModeChange: (mode: ContourMode) => void;
  onCountChange: (count: number) => void;
  onCustomLevelsChange: (levels: number[]) => void;
  onColorModeChange: (colorMode: ContourColorMode) => void;
  onColorChange: (color: string) => void;
  onShowLabelsChange: (showLabels: boolean) => void;
  onEmphasisChange: (levels: number[]) => void;
}

function parseCount(text: string): number | undefined {
  const val = Number(text);
  return text.trim() !== '' &&
    Number.isInteger(val) &&
    val >= 1 &&
    val <= MAX_COUNT
    ? val
    : undefined;
}

function formatLevels(
  levels: number[],
  format: (val: number) => string = formatInputVal,
): string {
  return levels.map((level) => format(level)).join(', ');
}

function ContoursControl(props: Props) {
  const {
    mode,
    count,
    customLevels,
    autoLevels,
    colorMode,
    color,
    showLabels,
    emphasis,
    onModeChange,
    onCountChange,
    onCustomLevelsChange,
    onColorModeChange,
    onColorChange,
    onShowLabelsChange,
    onEmphasisChange,
  } = props;

  const [draft, setDraft] = useState<string>();
  const [countDraft, setCountDraft] = useState<string>();
  const [emphasisDraft, setEmphasisDraft] = useState<string>();
  const levelsText = draft ?? formatLevels(customLevels);

  function commitDraft() {
    if (draft !== undefined) {
      onCustomLevelsChange(parseLevels(draft));
      setDraft(undefined);
    }
  }

  function commitEmphasis() {
    if (emphasisDraft !== undefined) {
      onEmphasisChange(parseLevels(emphasisDraft));
      setEmphasisDraft(undefined);
    }
  }

  const activeCount =
    mode === ContourMode.Auto
      ? autoLevels.length
      : mode === ContourMode.Custom
        ? customLevels.length
        : 0;

  return (
    <Popover
      label="Contours"
      Icon={MdTerrain}
      iconOnly // keep heatmap toolbar compact
    >
      <ToggleGroup
        role="radiogroup"
        ariaLabel="Contour levels"
        value={mode}
        onChange={(val) => {
          const newMode = val as ContourMode;
          if (newMode === ContourMode.Custom && customLevels.length === 0) {
            onCustomLevelsChange(autoLevels); // start from automatic levels
          }
          onModeChange(newMode);
        }}
      >
        <ToggleGroup.Btn label="Off" value={ContourMode.Off} />
        <ToggleGroup.Btn
          label="Auto"
          value={ContourMode.Auto}
          hint="Nice levels within the domain"
        />
        <ToggleGroup.Btn
          label="Custom"
          value={ContourMode.Custom}
          hint="Levels of your choice"
        />
      </ToggleGroup>

      {mode === ContourMode.Auto && (
        <label className={styles.field}>
          <span className={styles.label}>Number of levels</span>
          <input
            className={styles.numberInput}
            type="number"
            aria-label="Number of levels"
            min={1}
            max={MAX_COUNT}
            value={countDraft ?? count}
            onChange={(evt) => {
              // Let the input be emptied or hold invalid text while typing; apply valid counts right away
              const text = evt.currentTarget.value;
              setCountDraft(text);
              const val = parseCount(text);
              if (val !== undefined) {
                onCountChange(val);
              }
            }}
            onBlur={() => setCountDraft(undefined)}
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') {
                setCountDraft(undefined);
              }
            }}
          />
        </label>
      )}

      {mode === ContourMode.Custom && (
        <label className={styles.field}>
          <span className={styles.label}>Levels</span>
          <input
            className={styles.textInput}
            type="text"
            aria-label="Custom levels"
            placeholder="e.g. 0.1, 0.5, 1"
            value={levelsText}
            onChange={(evt) => setDraft(evt.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') {
                commitDraft();
              }
            }}
          />
        </label>
      )}

      {mode !== ContourMode.Off && (
        <>
          <p className={styles.summary} aria-label="Contour values">
            {activeCount > 0
              ? formatLevels(
                  mode === ContourMode.Auto ? autoLevels : customLevels,
                  formatTooltipVal,
                )
              : 'No levels'}
          </p>

          <div className={styles.field}>
            <span className={styles.label}>Colour</span>
            <ToggleGroup
              role="radiogroup"
              ariaLabel="Contour colour"
              value={colorMode}
              onChange={(val) => onColorModeChange(val as ContourColorMode)}
            >
              <ToggleGroup.Btn label="Single" value={ContourColorMode.Single} />
              <ToggleGroup.Btn
                label="Colour map"
                value={ContourColorMode.ColorMap}
                hint="Colour each line by its level"
              />
            </ToggleGroup>
            {colorMode === ContourColorMode.Single && (
              <input
                className={styles.colorInput}
                type="color"
                aria-label="Line colour"
                value={color}
                onChange={(evt) => onColorChange(evt.currentTarget.value)}
              />
            )}
          </div>

          <Checkbox
            label="Show labels"
            checked={showLabels}
            onChange={onShowLabelsChange}
          />
        </>
      )}

      {/* Drawn whatever the mode, e.g. only the zero contour */}
      <label className={styles.field}>
        <span className={styles.label}>Emphasize</span>
        <input
          className={styles.textInput}
          type="text"
          aria-label="Emphasized levels"
          placeholder="e.g. 0"
          value={emphasisDraft ?? formatLevels(emphasis)}
          onChange={(evt) => setEmphasisDraft(evt.currentTarget.value)}
          onBlur={commitEmphasis}
          onKeyDown={(evt) => {
            if (evt.key === 'Enter') {
              commitEmphasis();
            }
          }}
        />
      </label>
    </Popover>
  );
}

export default ContoursControl;
