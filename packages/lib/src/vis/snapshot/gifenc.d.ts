// Untyped dependency (only what `gif.ts` uses)
declare module 'gifenc' {
  type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array<ArrayBuffer>;
  };
}
