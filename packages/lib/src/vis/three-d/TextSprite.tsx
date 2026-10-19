import { type Size, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  type Camera,
  CanvasTexture,
  LinearFilter,
  PerspectiveCamera,
  type Sprite,
  SRGBColorSpace,
  Vector3,
  type Vector3Tuple,
} from 'three';

interface Props {
  text: string;
  position: Vector3Tuple;
  outward?: Vector3Tuple; // anchor text so it extends in this direction on screen
  color: string;
  fontSize: number; // in CSS pixels
  fontWeight?: number;
  fontFamily: string;
  priority?: number; // when labels overlap on screen, only the one with highest priority is shown
}

const PADDING = 2; // CSS pixels around text, to avoid clipping antialiased edges
const SCRIPT_SCALE = 0.7; // font size of sub/superscripts relative to the text's
const SCRIPT_SHIFT = { sub: 0.25, super: -0.35 }; // baseline shift, in font sizes

/* Runs of text, with `_{…}` and `^{…}` as subscripts and superscripts (e.g. `r_{12}`) */
export function parseScripts(
  text: string,
): { str: string; shift?: 'sub' | 'super' }[] {
  return text
    .split(/([\^_]\{[^}]*\})/u)
    .filter((part) => part.length > 0)
    .map((part) =>
      /^[\^_]\{.*\}$/u.test(part)
        ? {
            str: part.slice(2, -1),
            shift: part.startsWith('_') ? 'sub' : 'super',
          }
        : { str: part },
    );
}

export interface LabelUserData {
  isLabel: true;
  width: number; // CSS pixels
  height: number;
  priority: number;
  outward?: Vector3Tuple;
}

const start = new Vector3();
const end = new Vector3();

/**
 * Keep label at constant size on screen and anchor it on the side closest to the box,
 * so it extends outwards whatever the view angle. Must run before every render,
 * since camera and viewport size may change.
 */
export function updateLabelSprite(
  sprite: Sprite,
  camera: Camera,
  size: Size,
): void {
  const { width, height, outward } = sprite.userData as LabelUserData;

  // With `sizeAttenuation: false`, sprite scale is expressed at a distance of 1 from the camera
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
  const unitsPerPixel =
    (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(size.height, 1);
  sprite.scale.set(width * unitsPerPixel, height * unitsPerPixel, 1);

  if (!outward) {
    return;
  }

  start.copy(sprite.position).project(camera);
  end
    .copy(sprite.position)
    .add(new Vector3(...outward).multiplyScalar(0.1))
    .project(camera);

  const dx = (end.x - start.x) * size.width;
  const dy = (end.y - start.y) * size.height;
  const length = Math.hypot(dx, dy);

  if (length > 0 && Number.isFinite(length)) {
    sprite.center.set(0.5 - (0.5 * dx) / length, 0.5 - (0.5 * dy) / length);
  }
}

/**
 * Text that always faces the camera (billboard) and keeps a constant size on screen.
 * Rendered to a canvas texture to avoid depending on a font-loading library.
 */
function TextSprite(props: Props) {
  const {
    text,
    position,
    outward,
    color,
    fontSize,
    fontWeight = 400,
    fontFamily,
    priority = 0,
  } = props;

  const dpr = useThree((state) => state.viewport.dpr);

  const { texture, width, height } = useMemo(() => {
    const runs = parseScripts(text);
    const hasScripts = runs.some((run) => run.shift);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function getFont(shift?: 'sub' | 'super'): string {
      const size = shift ? fontSize * SCRIPT_SCALE : fontSize;
      return `${fontWeight} ${size}px ${fontFamily}`;
    }
    const runWidths = runs.map(({ str, shift }) => {
      if (!ctx) {
        return (str.match(/./gsu) ?? []).length * fontSize;
      }
      ctx.font = getFont(shift);
      return ctx.measureText(str).width;
    });

    const textWidth = runWidths.reduce((sum, w) => sum + w, 0);
    const cssWidth = Math.ceil(textWidth) + PADDING * 2;
    const cssHeight =
      Math.ceil(fontSize * (hasScripts ? 1.8 : 1.3)) + PADDING * 2; // room for scripts

    canvas.width = Math.max(cssWidth * dpr, 1);
    canvas.height = Math.max(cssHeight * dpr, 1);

    if (ctx) {
      ctx.scale(dpr, dpr); // resizing the canvas resets the context
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let x = (cssWidth - textWidth) / 2;
      runs.forEach(({ str, shift }, i) => {
        ctx.font = getFont(shift);
        const dy = shift ? SCRIPT_SHIFT[shift] * fontSize : 0;
        ctx.fillText(str, x, cssHeight / 2 + dy);
        x += runWidths[i];
      });
    }

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;

    return { texture: tex, width: cssWidth, height: cssHeight };
  }, [text, color, fontSize, fontWeight, fontFamily, dpr]);

  useEffect(() => () => texture.dispose(), [texture]);

  const spriteRef = useRef<Sprite>(null);

  useFrame(({ camera, size }) => {
    if (spriteRef.current) {
      updateLabelSprite(spriteRef.current, camera, size);
    }
  });

  return (
    <sprite
      ref={spriteRef}
      position={position}
      renderOrder={10}
      userData={{ isLabel: true, width, height, priority, outward }}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
        sizeAttenuation={false}
      />
    </sprite>
  );
}

export default TextSprite;
