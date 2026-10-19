import { useEffect, useState } from 'react';

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
