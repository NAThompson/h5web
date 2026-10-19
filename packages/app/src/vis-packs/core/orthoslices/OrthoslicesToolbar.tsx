import {
  ColorMapSelector,
  type Domain,
  DomainWidget,
  ORTHO_PLANE_COLORS,
  type OrthoPoint,
  ResetViewBtn,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import { COLOR_SCALE_TYPES } from '@h5web/shared/vis-models';
import { MdAspectRatio } from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { type OrthoslicesConfig } from './config';
import SliceIndexInput from './SliceIndexInput';
import { AXIS_NAMES, type OrthoAxis } from './utils';

const INTERACTIONS = [
  { shortcut: 'Click / Drag', description: 'Move crosshair' },
  { shortcut: 'Middle-drag', description: 'Pan' },
  { shortcut: 'Ctrl+Drag', description: 'Select to zoom' },
  { shortcut: 'Wheel', description: 'Zoom' },
  { shortcut: 'Drag (3D)', description: 'Rotate' },
];

interface Props {
  dataDomain: Domain;
  config: OrthoslicesConfig;
  point: OrthoPoint;
  sizes: [number, number, number]; // along x, y and z
  dimLabels: [string | undefined, string | undefined, string | undefined]; // of x, y and z
  onIndexChange: (axis: OrthoAxis, index: number) => void;
}

function OrthoslicesToolbar(props: Props) {
  const visArea = useVisArea();
  const { dataDomain, config, point, sizes, dimLabels, onIndexChange } = props;
  const {
    customDomain,
    colorMap,
    scaleType,
    invertColorMap,
    keepRatio,
    setCustomDomain,
    setColorMap,
    setScaleType,
    setInvertColorMap,
    setKeepRatio,
  } = config;

  return (
    <Toolbar interactions={INTERACTIONS}>
      {/* In the dataset's order: z, y, x */}
      {([2, 1, 0] as const).map((axis) => (
        <SliceIndexInput
          key={axis}
          label={AXIS_NAMES[axis]}
          title={dimLabels[axis]}
          color={ORTHO_PLANE_COLORS[axis]}
          value={point[axis]}
          count={sizes[axis]}
          onChange={(index) => onIndexChange(axis, index)}
        />
      ))}
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
      <Separator />

      <ResetViewBtn target={visArea} />
      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default OrthoslicesToolbar;
