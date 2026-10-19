import {
  ColorMapSelector,
  type Domain,
  DomainWidget,
  Menu,
  RadioGroup,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import { AXIS_SCALE_TYPES, COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import { FiBox } from 'react-icons/fi';
import { MdAspectRatio, MdBubbleChart, MdGridOn } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { BASE_INTERACTIONS, SURFACE_INTERACTIONS } from '../utils';
import { type ScatterConfig } from './config';

const SIZE_SCALES = [0.5, 1, 1.5, 2, 3];
const OPACITIES = [1, 0.5, 0.2, 0.05];

/* Options as strings, with the current value (e.g. from `H5WEB_point_opacity`) among them */
function getOptions(
  values: number[],
  current: number,
  format: (val: number) => string,
): { options: string[]; labels: Record<string, string> } {
  const all = values.includes(current) ? values : [...values, current];
  const sorted = all.toSorted((a, b) =>
    values[0] < values[1] ? a - b : b - a,
  );
  return {
    options: sorted.map(String),
    labels: Object.fromEntries(sorted.map((val) => [String(val), format(val)])),
  };
}

interface Props {
  dataDomain: Domain | undefined; // without colour values: no colour controls
  config: ScatterConfig;
  is3D: boolean;
}

/* Toolbar of points (`H5WEB_vis = "scatter"` / `"scatter3d"`) */
function PointsToolbar(props: Props) {
  const visArea = useVisArea();
  const { dataDomain, config, is3D } = props;
  const {
    customDomain,
    colorMap,
    scaleType,
    showGrid,
    invertColorMap,
    xScaleType,
    yScaleType,
    sizeScale,
    opacity,
    keepRatio,
    showAxes,
    setCustomDomain,
    setColorMap,
    setScaleType,
    setShowGrid,
    setInvertColorMap,
    setXScaleType,
    setYScaleType,
    setSizeScale,
    setOpacity,
    setKeepRatio,
    setShowAxes,
  } = config;
  const sizes = getOptions(SIZE_SCALES, sizeScale, (val) => `×${val}`);
  const opacities = getOptions(
    OPACITIES,
    opacity,
    (val) => `${Math.round(val * 100)} %`,
  );

  return (
    <Toolbar interactions={is3D ? SURFACE_INTERACTIONS : BASE_INTERACTIONS}>
      {!is3D && (
        <>
          <ScaleSelector
            label="X"
            value={xScaleType}
            onScaleChange={setXScaleType}
            options={AXIS_SCALE_TYPES}
          />
          <ScaleSelector
            label="Y"
            value={yScaleType}
            onScaleChange={setYScaleType}
            options={AXIS_SCALE_TYPES}
          />
          <Separator />
        </>
      )}

      {dataDomain && (
        <>
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
        </>
      )}

      {is3D && (
        <>
          <ToggleBtn
            label="Keep ratio"
            Icon={MdAspectRatio}
            value={keepRatio}
            onToggle={() => setKeepRatio(!keepRatio)}
          />
          <ToggleBtn
            label="Axes"
            Icon={FiBox}
            value={showAxes}
            onToggle={() => setShowAxes(!showAxes)}
          />
        </>
      )}
      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />

      <Menu label="Points" Icon={MdBubbleChart}>
        <RadioGroup
          name="pointsize"
          label="Size"
          options={sizes.options}
          optionsLabels={sizes.labels}
          value={String(sizeScale)}
          onChange={(val) => setSizeScale(Number(val))}
        />
        <RadioGroup
          name="pointopacity"
          label="Opacity"
          options={opacities.options}
          optionsLabels={opacities.labels}
          value={String(opacity)}
          onChange={(val) => setOpacity(Number(val))}
        />
      </Menu>
      <Separator />

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default PointsToolbar;
