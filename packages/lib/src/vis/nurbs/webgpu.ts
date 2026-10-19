import { getGpuParams, type KnotSpan, type NurbsCurve } from './nurbs';

export const MAX_GPU_DEGREE = 7; // size of the basis arrays of the compute shader
const WORKGROUP_SIZE = 64;

// `GPUBufferUsage` flags, missing from TypeScript's DOM types
const COPY_DST = 0x08;
export const UNIFORM = 0x40;
export const STORAGE = 0x80;

/* `a / b`, or 0 if `b` is 0 (cf. `0 / 0 = 0` of the B-spline recurrence) */
export const SAFE_DIVIDE_WGSL = /* wgsl */ `
  fn safeDivide(a: f32, b: f32) -> f32 {
    return select(a / b, 0.0, b == 0.0);
  }
`;

/* `evaluateNurbs` (A2.2 + A4.1) for each sample, in homogeneous coordinates, with `u` (of
 * `getGpuParams`) in `.w` */
const EVALUATE_WGSL = /* wgsl */ `
  struct Params { degree: u32, spanCount: u32, sampleCount: u32 }
  struct Span { knot: u32, first: u32, count: u32 } // \`count\` samples from sample \`first\`

  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> points: array<vec4f>; // x w, y w, z w, w
  @group(0) @binding(2) var<storage, read> knots: array<f32>;
  @group(0) @binding(3) var<storage, read> spans: array<Span>;
  @group(0) @binding(4) var<storage, read_write> samples: array<vec4f>;

  ${SAFE_DIVIDE_WGSL}

  @compute @workgroup_size(${WORKGROUP_SIZE})
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= params.sampleCount) {
      return;
    }

    // Last span starting at or before sample \`i\` (the end of the curve is in the last span)
    var low = 0u;
    var high = params.spanCount - 1u;
    while (low < high) {
      let mid = (low + high + 1u) / 2u;
      if (spans[mid].first <= i) { low = mid; } else { high = mid - 1u; }
    }
    let span = spans[low];
    let k = span.knot;
    let u = mix(knots[k], knots[k + 1u], f32(i - span.first) / f32(span.count));

    var basis: array<f32, ${MAX_GPU_DEGREE + 1}>;
    var left: array<f32, ${MAX_GPU_DEGREE + 1}>;
    var right: array<f32, ${MAX_GPU_DEGREE + 1}>;
    basis[0] = 1.0;
    for (var j = 1u; j <= params.degree; j++) {
      left[j] = u - knots[k + 1u - j];
      right[j] = knots[k + j] - u;
      var saved = 0.0;
      for (var r = 0u; r < j; r++) {
        let temp = safeDivide(basis[r], right[r + 1u] + left[j - r]);
        basis[r] = saved + right[r + 1u] * temp;
        saved = left[j - r] * temp;
      }
      basis[j] = saved;
    }

    var point = vec4f(0.0);
    for (var j = 0u; j <= params.degree; j++) {
      point += basis[j] * points[k - params.degree + j];
    }
    samples[i] = vec4f(point.xyz / point.w, u);
  }
`;

let devicePromise: Promise<GPUDevice | null> | undefined;

/* Shared device, or `null` without WebGPU (e.g. no `navigator.gpu`, or no adapter) */
export async function requestGpuDevice(): Promise<GPUDevice | null> {
  const gpu = navigator.gpu as GPU | undefined;
  if (!gpu) {
    return null;
  }

  if (!devicePromise) {
    devicePromise = createDevice(gpu);
  }
  return devicePromise;
}

async function createDevice(gpu: GPU): Promise<GPUDevice | null> {
  try {
    const adapter = await gpu.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      return null;
    }
    void forgetOnLoss(device);
    return device;
  } catch {
    return null;
  }
}

async function forgetOnLoss(device: GPUDevice): Promise<void> {
  await device.lost;
  devicePromise = undefined;
}

/*
 * Samples of a NURBS curve (2D or 3D), evaluated by a compute shader whenever the number of
 * samples of the spans changes: control points, knots and weights stay on the GPU.
 * Coordinates are relative to `origin`, to keep precision in `f32`.
 */
export class NurbsCurveSampler {
  public samples?: GPUBuffer; // `x, y, z, u` per sample; replaced when more are needed
  public sampleCount = 0;
  private readonly pipeline: GPUComputePipeline;
  private readonly params: GPUBuffer;
  private readonly points: GPUBuffer;
  private readonly knots: GPUBuffer;
  private readonly spanTable: GPUBuffer;
  private counts?: Uint32Array;

  public constructor(
    private readonly device: GPUDevice,
    curve: NurbsCurve,
    private readonly spans: KnotSpan[],
    origin: number[],
  ) {
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: EVALUATE_WGSL }) },
    });

    const { degree, dims, points, weights } = curve;
    const homogeneous = new Float32Array(weights.length * 4);
    weights.forEach((w, i) => {
      const xyz = [0, 1, 2].map((d) =>
        d < dims ? (points[i * dims + d] - (origin[d] ?? 0)) * w : 0,
      );
      homogeneous.set([...xyz, w], i * 4);
    });

    this.params = createBuffer(device, 16, UNIFORM);
    this.points = createBuffer(device, homogeneous, STORAGE);
    this.knots = createBuffer(device, getGpuParams(curve), STORAGE);
    this.spanTable = createBuffer(device, spans.length * 12, STORAGE);

    device.queue.writeBuffer(
      this.params,
      0,
      Uint32Array.from([degree, spans.length, 0, 0]),
    );
  }

  /* Evaluates the curve again if the spans need other numbers of segments */
  public setSegmentCounts(counts: Uint32Array): void {
    const { device, spans, counts: prevCounts } = this;
    if (prevCounts && counts.every((n, i) => n === prevCounts[i])) {
      return;
    }
    this.counts = counts;

    const table = new Uint32Array(spans.length * 3);
    let first = 0;
    spans.forEach(({ index }, s) => {
      table.set([index, first, counts[s]], s * 3);
      first += counts[s];
    });
    this.sampleCount = first + 1;

    if (!this.samples || this.samples.size < this.sampleCount * 16) {
      this.samples?.destroy();
      this.samples = createBuffer(
        device,
        2 ** Math.ceil(Math.log2(this.sampleCount * 16)), // room to zoom in
        STORAGE,
      );
    }

    device.queue.writeBuffer(this.spanTable, 0, table);
    device.queue.writeBuffer(this.params, 8, Uint32Array.of(this.sampleCount));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          this.params,
          this.points,
          this.knots,
          this.spanTable,
          this.samples,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(this.sampleCount / WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  public dispose(): void {
    for (const buffer of [
      this.params,
      this.points,
      this.knots,
      this.spanTable,
      this.samples,
    ]) {
      buffer?.destroy();
    }
  }
}

/* Buffer of given size or with given data (writable, e.g. by `queue.writeBuffer`) */
export function createBuffer(
  device: GPUDevice,
  sizeOrData: number | Float32Array | Uint32Array,
  usage: number,
): GPUBuffer {
  const isData = typeof sizeOrData !== 'number';
  const buffer = device.createBuffer({
    size: Math.max(isData ? sizeOrData.byteLength : sizeOrData, 16),
    usage: usage | COPY_DST, // eslint-disable-line no-bitwise -- usage flags
  });
  if (isData) {
    device.queue.writeBuffer(buffer, 0, sizeOrData);
  }
  return buffer;
}
