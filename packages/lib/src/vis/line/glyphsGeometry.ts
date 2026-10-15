import { type BufferAttribute, BufferGeometry } from 'three';

import { type H5WebGeometry } from '../models';
import { createBufferAttr, Z_OUT } from '../utils';
import { type LineGeometryParams } from './lineGeometry';

interface Params extends LineGeometryParams {
  isolatedOnly?: boolean; // only points without valid neighbours, which no line segment shows
}

class GlyphsGeometry
  extends BufferGeometry<Record<'position', BufferAttribute>>
  implements H5WebGeometry
{
  public constructor(private readonly params: Params) {
    super();
    const { length } = params.ordinates;
    this.setAttribute('position', createBufferAttr(length));
  }

  public update(): void {
    const { position: positions } = this.attributes;
    const { ordinates, isolatedOnly } = this.params;

    let prev: [number, number] | undefined;
    let curr = this.getPoint(0);
    for (let index = 0; index < ordinates.length; index += 1) {
      const next = this.getPoint(index + 1);

      if (curr && (!isolatedOnly || (!prev && !next))) {
        positions.setXYZ(index, curr[0], curr[1], 0);
      } else {
        positions.setXYZ(index, 0, 0, Z_OUT);
      }

      prev = curr;
      curr = next;
    }
  }

  private getPoint(index: number): [number, number] | undefined {
    const { abscissas, ordinates, abscissaScale, ordinateScale, ignoreValue } =
      this.params;

    if (index >= ordinates.length) {
      return undefined;
    }

    const value = ordinates[index];
    if (ignoreValue?.(value)) {
      return undefined;
    }

    const x = abscissaScale(abscissas[index]);
    const y = ordinateScale(value);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
  }
}

export default GlyphsGeometry;
