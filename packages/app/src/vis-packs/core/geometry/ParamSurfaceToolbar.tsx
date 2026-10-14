import {
  ColorMapSelector,
  type Domain,
  DomainWidget,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  SurfaceRepresentation,
  ToggleBtn,
  ToggleGroup,
  Toolbar,
} from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import { MdAspectRatio, MdGridOn, MdWbSunny } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { SURFACE_INTERACTIONS } from '../utils';
import { type ParamSurfaceConfig } from './surface-config';

interface Props {
  dataDomain: Domain;
  config: ParamSurfaceConfig;
}

function ParamSurfaceToolbar(props: Props) {
  const visArea = useVisArea();
  const { dataDomain, config } = props;
  const {
    customDomain,
    colorMap,
    invertColorMap,
    scaleType,
    keepRatio,
    showGrid,
    representation,
    shading,
    setCustomDomain,
    setColorMap,
    setInvertColorMap,
    setScaleType,
    setKeepRatio,
    setShowGrid,
    setRepresentation,
    setShading,
  } = config;

  return (
    <Toolbar interactions={SURFACE_INTERACTIONS}>
      <ToggleGroup
        role="radiogroup"
        ariaLabel="Representation"
        value={representation}
        onChange={(val) => setRepresentation(val as SurfaceRepresentation)}
      >
        <ToggleGroup.Btn
          label="Surface"
          value={SurfaceRepresentation.Surface}
        />
        <ToggleGroup.Btn
          label="Wireframe"
          value={SurfaceRepresentation.Wireframe}
        />
        <ToggleGroup.Btn
          label="Both"
          value={SurfaceRepresentation.SurfaceWithEdges}
          hint="Surface with edges"
        />
      </ToggleGroup>
      <ToggleBtn
        label="Shading"
        Icon={MdWbSunny}
        value={shading}
        disabled={representation === SurfaceRepresentation.Wireframe}
        onToggle={() => setShading(!shading)}
      />
      <Separator />

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

      <ToggleBtn
        label="Keep ratio"
        Icon={MdAspectRatio}
        value={keepRatio}
        onToggle={() => setKeepRatio(!keepRatio)}
      />
      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />
      <Separator />

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default ParamSurfaceToolbar;
