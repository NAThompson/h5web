import {
  ColorMapSelector,
  type Domain,
  DomainWidget,
  ResetViewBtn,
  ScaleSelector,
  Selector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
  VectorBackground,
  VectorStyle,
} from '@h5web/lib';
import { type ColorScaleType } from '@h5web/shared/vis-models';
import {
  MdAspectRatio,
  MdGridOn,
  MdOutlineViewInAr,
  MdStraighten,
} from 'react-icons/md';

import { useVisArea } from '../../visualizer/vis-area';
import LabelledRange from '../core/LabelledRange';
import { type VectorConfig } from './config';

const STYLE_LABELS: Record<VectorStyle, string> = {
  [VectorStyle.Arrows]: 'Arrows',
  [VectorStyle.Streamlines]: 'Streamlines',
  [VectorStyle.Lic]: 'LIC',
};

export const BACKGROUND_LABELS: Record<VectorBackground, string> = {
  [VectorBackground.Magnitude]: 'Magnitude',
  [VectorBackground.None]: 'None',
  [VectorBackground.Divergence]: 'Divergence',
  [VectorBackground.Curl]: 'Curl',
  [VectorBackground.Dataset]: 'Dataset',
};

const PLANES = ['all', 'x', 'y', 'z'] as const;

interface Props {
  config: VectorConfig;
  dataDomain: Domain;
  colorMap: VectorConfig['colorMap'] & string; // resolved (e.g. automatic)
  invertColorMap: boolean;
  is3D: boolean;
  backgrounds: VectorBackground[];
  datasetLabel?: string; // name of the background dataset, if any
  planeSize?: number; // 3D: samples along the chosen plane's axis
  scaleType: ColorScaleType; // applied (e.g. linear for signed backgrounds)
  scaleTypes: ColorScaleType[]; // available ones
}

function VectorToolbar(props: Props) {
  const {
    config,
    dataDomain,
    colorMap,
    invertColorMap,
    is3D,
    backgrounds,
    datasetLabel,
    planeSize = 1,
    scaleType,
    scaleTypes,
  } = props;
  const visArea = useVisArea();
  const styles = is3D
    ? [VectorStyle.Arrows, VectorStyle.Streamlines]
    : Object.values(VectorStyle);

  return (
    <Toolbar>
      <Selector
        label="Style"
        value={config.style}
        onChange={config.setStyle}
        options={styles}
        renderOption={(option) => STYLE_LABELS[option]}
      />
      {!is3D && (
        <Selector
          label="Background"
          value={config.background}
          onChange={config.setBackground}
          options={backgrounds}
          renderOption={(option) =>
            option === VectorBackground.Dataset && datasetLabel
              ? datasetLabel
              : BACKGROUND_LABELS[option]
          }
        />
      )}
      {is3D && (
        <>
          <Selector
            label="Plane"
            value={config.plane ?? 'all'}
            onChange={(value) =>
              config.setPlane(value === 'all' ? undefined : value)
            }
            options={[...PLANES]}
            renderOption={(option) =>
              option === 'all' ? 'All' : `${option} = const`
            }
          />
          {config.plane && (
            <LabelledRange
              label={config.plane}
              ariaLabel="Plane index"
              min={0}
              max={planeSize - 1}
              step={1}
              value={Math.min(config.planeIndex, planeSize - 1)}
              format={(val) => `${val}`}
              onChange={config.setPlaneIndex}
            />
          )}
        </>
      )}
      <Separator />

      {config.style !== VectorStyle.Lic && (
        <>
          <LabelledRange
            label="Length"
            ariaLabel="Arrow scale"
            min={0.1}
            max={4}
            step={0.1}
            value={config.arrowScale}
            format={(val) => `×${val.toFixed(1)}`}
            onChange={config.setArrowScale}
          />
          {!is3D && config.style === VectorStyle.Arrows && (
            <ToggleBtn
              label="Same length"
              Icon={MdStraighten}
              value={config.uniformArrows}
              onToggle={() => config.setUniformArrows(!config.uniformArrows)}
            />
          )}
          {!is3D && (
            <LabelledRange
              label="Density"
              ariaLabel="Arrow density"
              min={1}
              max={8}
              step={0.5}
              value={config.arrowDensity}
              format={(val) => `${val}`}
              onChange={config.setArrowDensity}
            />
          )}
          <Separator />
        </>
      )}

      <DomainWidget
        dataDomain={dataDomain}
        customDomain={config.customDomain}
        scaleType={scaleType}
        onCustomDomainChange={config.setCustomDomain}
      />
      <Separator />
      <ColorMapSelector
        value={colorMap}
        onValueChange={config.setColorMap}
        invert={invertColorMap}
        onInversionChange={() => config.setInvertColorMap(!invertColorMap)}
      />
      {!is3D && (
        <>
          <Separator />
          <ScaleSelector
            value={scaleType}
            onScaleChange={config.setScaleType}
            options={scaleTypes}
          />
        </>
      )}
      <Separator />

      {is3D ? (
        <ToggleBtn
          label="Axes"
          Icon={MdOutlineViewInAr}
          value={config.showAxes}
          onToggle={() => config.setShowAxes(!config.showAxes)}
        />
      ) : (
        <ToggleBtn
          label="Keep ratio"
          Icon={MdAspectRatio}
          value={config.keepRatio ?? true}
          onToggle={() => config.setKeepRatio(!(config.keepRatio ?? true))}
        />
      )}
      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={config.showGrid}
        onToggle={() => config.setShowGrid(!config.showGrid)}
      />
      <Separator />
      {is3D && <ResetViewBtn target={visArea} />}
      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default VectorToolbar;
