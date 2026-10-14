import {
  ColorMapSelector,
  type Domain,
  DomainWidget,
  ScaleSelector,
  Selector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  ToggleGroup,
  Toolbar,
  VolumeQuality,
  VolumeRenderMode,
} from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import { MdBlurOn } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { type VolumeConfig } from './config';
import IsosurfacesControl from './IsosurfacesControl';
import RangeControl from './RangeControl';

const QUALITY_LABELS: Record<VolumeQuality, string> = {
  [VolumeQuality.Low]: 'Low',
  [VolumeQuality.Medium]: 'Medium',
  [VolumeQuality.High]: 'High',
};

interface Props {
  dataDomain: Domain;
  config: VolumeConfig;
  isoStep: number;
}

function VolumeToolbar(props: Props) {
  const visArea = useVisArea();
  const { dataDomain, config, isoStep } = props;
  const {
    customDomain,
    colorMap,
    scaleType,
    invertColorMap,
    mode,
    opacity,
    threshold,
    quality,
    showVolume,
    isoLevels,
    isoColorMode,
    setCustomDomain,
    setColorMap,
    setScaleType,
    setInvertColorMap,
    setMode,
    setOpacity,
    setThreshold,
    setQuality,
    setShowVolume,
    addIsoLevel,
    updateIsoLevel,
    removeIsoLevel,
    setIsoColorMode,
  } = config;

  return (
    <Toolbar>
      <ToggleBtn
        label="Volume"
        aria-label="Show volume"
        Icon={MdBlurOn}
        value={showVolume}
        onToggle={() => setShowVolume(!showVolume)}
      />
      <IsosurfacesControl
        levels={isoLevels}
        domain={dataDomain}
        scaleType={scaleType}
        colorMode={isoColorMode}
        step={isoStep}
        onAdd={addIsoLevel}
        onUpdate={updateIsoLevel}
        onRemove={removeIsoLevel}
        onColorModeChange={setIsoColorMode}
      />
      <Separator />

      {showVolume && (
        <>
          <ToggleGroup
            role="radiogroup"
            ariaLabel="Rendering mode"
            value={mode}
            onChange={(val) => setMode(val as VolumeRenderMode)}
          >
            <ToggleGroup.Btn
              label="MIP"
              value={VolumeRenderMode.MIP}
              hint="Maximum intensity projection"
            />
            <ToggleGroup.Btn
              label="DVR"
              value={VolumeRenderMode.DVR}
              hint="Direct volume rendering"
            />
            <ToggleGroup.Btn
              label="Iso"
              value={VolumeRenderMode.Iso}
              hint="Isosurface"
            />
          </ToggleGroup>
          <Separator />

          <RangeControl
            label={mode === VolumeRenderMode.Iso ? 'Iso value' : 'Threshold'}
            value={threshold}
            onChange={setThreshold}
          />
          {mode === VolumeRenderMode.DVR && (
            <RangeControl
              label="Opacity"
              value={opacity}
              onChange={setOpacity}
            />
          )}
          <Separator />
        </>
      )}

      <DomainWidget
        dataDomain={dataDomain}
        customDomain={customDomain}
        scaleType={scaleType}
        onCustomDomainChange={setCustomDomain}
      />
      <Separator />

      <ColorMapSelector
        value={colorMap}
        onValueChange={setColorMap}
        invert={invertColorMap}
        onInversionChange={() => setInvertColorMap(!invertColorMap)}
      />
      <Separator />

      <ScaleSelector
        value={scaleType}
        onScaleChange={setScaleType}
        options={COLOR_SCALE_TYPES}
      />
      <Separator />

      {showVolume && (
        <>
          <Selector
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={Object.values(VolumeQuality)}
            renderOption={(option) => QUALITY_LABELS[option]}
          />
          <Separator />
        </>
      )}

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default VolumeToolbar;
