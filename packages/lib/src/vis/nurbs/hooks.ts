import { type Domain } from '@h5web/shared/vis-models';
import { useCallback, useEffect, useState } from 'react';

import { getColorByDomain, NurbsColorBy } from './analysis';
import { MAX_GPU_DEGREE, requestGpuDevice } from './webgpu';

/* WebGPU device to draw NURBS of given degree (`undefined` until known), requested again if lost;
 * throws (for error boundaries) without WebGPU, if lost again, or if the degree is too high */
export function useGpuDevice(degree: number): GPUDevice | undefined {
  const [device, setDevice] = useState<GPUDevice | null>();
  const [lossCount, setLossCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    function isActive(): boolean {
      return !controller.signal.aborted;
    }
    void (async () => {
      const dev = lossCount < 2 ? await requestGpuDevice() : null;
      if (!isActive()) {
        return;
      }
      setDevice(dev);

      if (dev) {
        await dev.lost;
        if (isActive()) {
          setDevice(undefined);
          setLossCount((count) => count + 1);
        }
      }
    })();
    return () => controller.abort();
  }, [lossCount]);

  if (degree > MAX_GPU_DEGREE) {
    throw new Error(
      `Degree ${degree} is above the maximum of ${MAX_GPU_DEGREE} for WebGPU rendering`,
    );
  }
  if (device === null) {
    throw new Error(
      lossCount < 2
        ? "NURBS rendering needs WebGPU, which this browser doesn't provide"
        : 'NURBS rendering needs WebGPU, whose device was lost twice',
    );
  }
  return device;
}

/*
 * Colour domain of a NURBS surface: `zDomain` (of heights sampled on the CPU for the box), else
 * that of the values read back from the GPU (`handleValues`), the last one until they are read
 */
export function useColorDomain(
  colorBy: NurbsColorBy,
  colorField: number,
  zDomain: Domain,
  onDataDomainChange?: (domain: Domain) => void,
): {
  dataDomain: Domain;
  handleValues: (
    values: Float64Array,
    areas: Float64Array,
    colorBy: NurbsColorBy,
  ) => void;
} {
  const [read, setRead] = useState<{ key: string; domain: Domain }>();
  const key = `${colorBy} ${colorField}`;
  const handleValues = useCallback(
    (values: Float64Array, areas: Float64Array, valuesColorBy: NurbsColorBy) =>
      setRead({ key, domain: getColorByDomain(values, valuesColorBy, areas) }),
    [key],
  );

  const isHeight = colorBy === NurbsColorBy.Height;
  const dataDomain = isHeight ? zDomain : (read?.domain ?? zDomain);
  const isRead = isHeight || read?.key === key;
  useEffect(() => {
    if (isRead) {
      onDataDomainChange?.(dataDomain);
    }
  }, [isRead, dataDomain, onDataDomainChange]);

  return { dataDomain, handleValues };
}
