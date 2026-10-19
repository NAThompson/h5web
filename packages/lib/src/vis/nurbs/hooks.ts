import { useEffect, useState } from 'react';

import { requestGpuDevice } from './webgpu';

/* WebGPU device, `null` without WebGPU or if not `enabled` (`undefined` until known);
 * requested again if lost, then `null` if lost again */
export function useGpuDevice(enabled: boolean): GPUDevice | null | undefined {
  const [device, setDevice] = useState<GPUDevice | null>();
  const [lossCount, setLossCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    function isActive(): boolean {
      return !controller.signal.aborted;
    }
    void (async () => {
      const dev = enabled && lossCount < 2 ? await requestGpuDevice() : null;
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
  }, [enabled, lossCount]);

  return device;
}
