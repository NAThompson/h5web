import {
  ColorMapSelector,
  ComplexVisTypeSelector,
  type Domain,
  DomainWidget,
  ExportMenu,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import {
  COLOR_SCALE_TYPES,
  type ComplexHeatmapVisType,
  ComplexVisType,
  type ExportEntry,
} from '@h5web/shared/vis-models';
import {
  MdAspectRatio,
  MdGridOn,
  MdSwapHoriz,
  MdSwapVert,
  MdViewInAr,
  MdWbSunny,
} from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { getImageInteractions, SURFACE_INTERACTIONS } from '../utils';
import { type HeatmapConfig } from './config';
import ContoursControl from './ContoursControl';
import HeightScaleSlider from './HeightScaleSlider';

const COMPLEX_VIS_TYPES: ComplexHeatmapVisType[] = [
  ComplexVisType.Amplitude,
  ComplexVisType.Phase,
  ComplexVisType.PhaseAmplitude,
];

interface Props {
  dataDomain: Domain;
  isSlice?: boolean;
  isComplex?: boolean;
  withSurface?: boolean;
  config: HeatmapConfig;
  exportEntries?: ExportEntry[];
  /* Automatic contour levels; contour controls are shown only when provided */
  autoContourLevels?: number[];
}

function HeatmapToolbar(props: Props) {
  const visArea = useVisArea();
  const {
    dataDomain,
    isSlice,
    isComplex,
    withSurface,
    config,
    exportEntries,
    autoContourLevels,
  } = props;
  const {
    customDomain,
    colorMap,
    invertColorMap,
    scaleType,
    complexVisType,
    showGrid,
    keepRatio,
    flipXAxis,
    flipYAxis,
    surface,
    heightScale,
    shading,
    setCustomDomain,
    setColorMap,
    setInvertColorMap,
    setScaleType,
    setComplexVisType,
    setShowGrid,
    setKeepRatio,
    setFlipXAxis,
    setFlipYAxis,
    setSurface,
    setHeightScale,
    setShading,
  } = config;

  const showSurface = withSurface && surface;

  return (
    <Toolbar
      interactions={
        showSurface ? SURFACE_INTERACTIONS : getImageInteractions(keepRatio)
      }
    >
      {withSurface && (
        <>
          <ToggleBtn
            label="3D"
            aria-label="Show as 3D surface"
            Icon={MdViewInAr}
            value={surface}
            onToggle={() => setSurface(!surface)}
          />

          {surface && (
            <>
              <HeightScaleSlider
                value={heightScale}
                onChange={setHeightScale}
              />
              <ToggleBtn
                label="Shading"
                Icon={MdWbSunny}
                value={shading}
                onToggle={() => setShading(!shading)}
              />
            </>
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

      {isComplex && (
        <ComplexVisTypeSelector
          value={complexVisType}
          onChange={setComplexVisType}
          options={COMPLEX_VIS_TYPES}
        />
      )}

      <Separator />

      {autoContourLevels && !showSurface && (
        <>
          <ContoursControl
            mode={config.contourMode}
            count={config.contourCount}
            customLevels={config.contourLevels}
            autoLevels={autoContourLevels}
            colorMode={config.contourColorMode}
            color={config.contourColor}
            showLabels={config.contourLabels}
            onModeChange={config.setContourMode}
            onCountChange={config.setContourCount}
            onCustomLevelsChange={config.setContourLevels}
            onColorModeChange={config.setContourColorMode}
            onColorChange={config.setContourColor}
            onShowLabelsChange={config.setContourLabels}
          />
          <Separator />
        </>
      )}

      <ToggleBtn
        label="X"
        aria-label="Flip X"
        Icon={MdSwapHoriz}
        value={flipXAxis}
        onToggle={() => setFlipXAxis(!flipXAxis)}
      />
      <ToggleBtn
        label="Y"
        aria-label="Flip Y"
        Icon={MdSwapVert}
        value={flipYAxis}
        onToggle={() => setFlipYAxis(!flipYAxis)}
      />

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

      {exportEntries && exportEntries.length > 0 && (
        <ExportMenu isSlice={isSlice} entries={exportEntries} />
      )}

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default HeatmapToolbar;
