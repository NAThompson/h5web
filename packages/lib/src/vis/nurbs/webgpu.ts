import { type KnotSpan, type NurbsCurve } from './nurbs';

export const MAX_GPU_DEGREE = 7; // size of the basis arrays of the compute shader
const WORKGROUP_SIZE = 64;

// `GPUBufferUsage` flags, missing from TypeScript's DOM types
const COPY_DST = 0x08;
const UNIFORM = 0x40;
const STORAGE = 0x80;

/* `evaluateNurbs` (A2.2 + A4.1) for each sample, in homogeneous coordinates */
const EVALUATE_WGSL = /* wgsl */ `
  struct Params { degree: u32, spanCount: u32, sampleCount: u32 }
  struct Span { knot: u32, first: u32, count: u32 } // \`count\` samples from sample \`first\`

  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> points: array<vec4f>; // x w, y w, z w, w
  @group(0) @binding(2) var<storage, read> knots: array<f32>;
  @group(0) @binding(3) var<storage, read> spans: array<Span>;
  @group(0) @binding(4) var<storage, read_write> samples: array<vec4f>;

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
        let temp = basis[r] / (right[r + 1u] + left[j - r]);
        basis[r] = saved + right[r + 1u] * temp;
        saved = left[j - r] * temp;
      }
      basis[j] = saved;
    }

    var point = vec4f(0.0);
    for (var j = 0u; j <= params.degree; j++) {
      point += basis[j] * points[k - params.degree + j];
    }
    samples[i] = vec4f(point.xyz / point.w, 1.0);
  }
`;

/* Each chord between consecutive samples as a quad of constant width on screen */
const DRAW_WGSL = /* wgsl */ `
  struct View {
    scale: vec2f, // device pixels per unit
    offset: vec2f, // device pixels from centre of canvas (y up) of origin of samples
    halfSize: vec2f, // half size of canvas in device pixels
    width: f32, // in device pixels
    color: vec4f, // premultiplied
  }

  struct Varyings {
    @builtin(position) position: vec4f,
    @location(0) across: f32, // device pixels from centre line
  }

  @group(0) @binding(0) var<uniform> view: View;
  @group(0) @binding(1) var<storage, read> samples: array<vec4f>;

  @vertex
  fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) chord: u32) -> Varyings {
    let a = samples[chord].xy * view.scale + view.offset;
    let b = samples[chord + 1u].xy * view.scale + view.offset;
    let len = length(b - a);
    let dir = select(vec2f(1.0, 0.0), (b - a) / len, len > 1e-6);
    let normal = vec2f(-dir.y, dir.x);
    let half = 0.5 * view.width + 1.0; // one more pixel to antialias edges

    // Two triangles; ends overlap the next chords' to cover the joins
    var ends = array(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
    var sides = array(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
    let along = mix(a - dir * half, b + dir * half, ends[v]);

    var out: Varyings;
    out.position = vec4f((along + normal * half * sides[v]) / view.halfSize, 0.0, 1.0);
    out.across = half * sides[v];
    return out;
  }

  @fragment
  fn fragmentMain(in: Varyings) -> @location(0) vec4f {
    return view.color * clamp(0.5 * view.width + 0.5 - abs(in.across), 0.0, 1.0);
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

export interface GpuView {
  scale: [number, number];
  offset: [number, number];
  size: [number, number]; // of canvas in device pixels
  width: number;
  color: [number, number, number, number]; // premultiplied
}

/*
 * Draws a 2D NURBS curve in a WebGPU canvas: control points, knots and weights stay on the GPU,
 * where a compute shader evaluates the curve into samples whenever the number of samples of
 * the spans changes (i.e. on zoom), and a render pass draws the chords between them.
 * Coordinates are relative to `origin`, to keep precision in `f32`.
 */
export class NurbsGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format = navigator.gpu.getPreferredCanvasFormat();
  private readonly evaluatePipeline: GPUComputePipeline;
  private readonly drawPipeline: GPURenderPipeline;
  private readonly params: GPUBuffer;
  private readonly points: GPUBuffer;
  private readonly knots: GPUBuffer;
  private readonly spanTable: GPUBuffer;
  private readonly view: GPUBuffer;
  private samples?: GPUBuffer;
  private drawBindGroup?: GPUBindGroup;
  private sampleCount = 0;
  private counts?: Uint32Array;

  public constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    curve: NurbsCurve,
    private readonly spans: KnotSpan[],
    origin: [number, number],
  ) {
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
      throw new Error('Expected WebGPU canvas context');
    }
    this.context = context;
    context.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.evaluatePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: EVALUATE_WGSL }) },
    });

    const drawModule = device.createShaderModule({ code: DRAW_WGSL });
    this.drawPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule },
      fragment: {
        module: drawModule,
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
    });

    const { degree, dims, points, weights, knots } = curve;
    const homogeneous = new Float32Array(weights.length * 4);
    weights.forEach((w, i) => {
      homogeneous.set(
        [
          (points[i * dims] - origin[0]) * w,
          (points[i * dims + 1] - origin[1]) * w,
          0,
          w,
        ],
        i * 4,
      );
    });

    this.params = this.createBuffer(16, UNIFORM);
    this.points = this.createBuffer(homogeneous, STORAGE);
    this.knots = this.createBuffer(Float32Array.from(knots), STORAGE);
    this.spanTable = this.createBuffer(spans.length * 12, STORAGE);
    this.view = this.createBuffer(48, UNIFORM);

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
      this.samples = this.createBuffer(
        2 ** Math.ceil(Math.log2(this.sampleCount * 16)), // room to zoom in
        STORAGE,
      );
      this.drawBindGroup = device.createBindGroup({
        layout: this.drawPipeline.getBindGroupLayout(0),
        entries: [this.view, this.samples].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
    }

    device.queue.writeBuffer(this.spanTable, 0, table);
    device.queue.writeBuffer(this.params, 8, Uint32Array.of(this.sampleCount));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.evaluatePipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: this.evaluatePipeline.getBindGroupLayout(0),
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

  /* Flags the canvas with `data-drawn` once drawn (e.g. for tests) */
  public async draw(view: GpuView): Promise<void> {
    const { device } = this;
    const { scale, offset, size, width, color } = view;

    device.queue.writeBuffer(
      this.view,
      0,
      Float32Array.from([
        ...scale,
        ...offset,
        size[0] / 2,
        size[1] / 2,
        width,
        0,
        ...color,
      ]),
    );

    this.redraw();
    await device.queue.onSubmittedWorkDone();
    this.canvas.dataset.drawn = '';
  }

  /* Draws again with the last view, e.g. right before copying the canvas */
  public redraw(): void {
    const { device, drawBindGroup } = this;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (drawBindGroup && this.sampleCount > 1) {
      pass.setPipeline(this.drawPipeline);
      pass.setBindGroup(0, drawBindGroup);
      pass.draw(6, this.sampleCount - 1);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  public dispose(): void {
    this.context.unconfigure();
    for (const buffer of [
      this.params,
      this.points,
      this.knots,
      this.spanTable,
      this.view,
      this.samples,
    ]) {
      buffer?.destroy();
    }
  }

  private createBuffer(
    sizeOrData: number | Float32Array,
    usage: number,
  ): GPUBuffer {
    const isData = typeof sizeOrData !== 'number';
    const buffer = this.device.createBuffer({
      size: Math.max(isData ? sizeOrData.byteLength : sizeOrData, 16),
      usage: usage | COPY_DST, // eslint-disable-line no-bitwise -- usage flags
    });
    if (isData) {
      this.device.queue.writeBuffer(buffer, 0, sizeOrData);
    }
    return buffer;
  }
}
