import { type ScaleType } from '@h5web/shared/vis-models';

import { GLSL_IS_SUPPORTED, GLSL_LOG1P, GLSL_SCALE } from '../heatmap/utils';
import { VolumeRenderMode } from './models';

export const VOLUME_VERTEX_SHADER = /* glsl */ `
  out vec3 vPosition;
  flat out vec3 vOrigin;

  void main() {
    vPosition = position;
    vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

/* `#define`s of the non-uniform axes, for `GLSL_TEX_COORDS` */
export function getLookupDefines(
  lookups: [x: boolean, y: boolean, z: boolean],
): string {
  return ['X', 'Y', 'Z']
    .filter((_, i) => lookups[i])
    .map((axis) => `#define LOOKUP_${axis}`)
    .join('\n');
}

/* Texture coordinates of positions in the box, voxels at their coordinates on non-uniform axes */
export const GLSL_TEX_COORDS = /* glsl */ `
    // Non-uniform axes: relative positions of voxel edges and centres (cf. \`getAxisLookup\`)
    uniform sampler2D xLookup;
    uniform sampler2D yLookup;
    uniform sampler2D zLookup;
    uniform vec3 dims;

    // Knot of a lookup table, wrapped onto rows (cf. \`getLookupTexture\`)
    float knot(sampler2D knots, int k) {
      int width = textureSize(knots, 0).x;
      return texelFetch(knots, ivec2(k % width, k / width), 0).r;
    }

    // Texture coordinate at a relative position, between the knots around it (binary search) of
    // the edges and centres of \`voxels\`
    float lookUp(sampler2D knots, float voxels, float pos) {
      int count = 2 * int(voxels) + 1;
      int lo = 0;
      int hi = count - 2;
      for (int k = 0; k < 24; k++) {
        if (lo >= hi) break;
        int mid = (lo + hi + 1) / 2;
        if (knot(knots, mid) <= pos) { lo = mid; } else { hi = mid - 1; }
      }
      float start = knot(knots, lo);
      float end = knot(knots, lo + 1);
      float t = clamp((pos - start) / max(end - start, 1e-30), 0., 1.);
      return (float(lo) + t) / float(count - 1);
    }

    // Texture coordinates of a position in the box (voxels at their coordinates on non-uniform axes)
    vec3 toTexCoords(vec3 p) {
      #ifdef LOOKUP_X
        p.x = lookUp(xLookup, dims.x, p.x);
      #endif
      #ifdef LOOKUP_Y
        p.y = lookUp(yLookup, dims.y, p.y);
      #endif
      #ifdef LOOKUP_Z
        p.z = lookUp(zLookup, dims.z, p.z);
      #endif
      return p;
    }
`;

const MODE_DEFINES: Record<VolumeRenderMode, string> = {
  [VolumeRenderMode.MIP]: 'MODE_MIP',
  [VolumeRenderMode.DVR]: 'MODE_DVR',
  [VolumeRenderMode.Iso]: 'MODE_ISO',
};

/*
 * Single-pass ray marcher. The bounding box is rendered with back faces only,
 * so that rays are cast even when the camera is inside the volume. Rays are
 * marched in texture space ([0, 1]^3) with a step size expressed in voxels,
 * jittered per pixel to hide wood-grain artefacts.
 */
export function getVolumeFragmentShader(
  mode: VolumeRenderMode,
  scaleType: ScaleType,
  lookups: [x: boolean, y: boolean, z: boolean] = [false, false, false],
  withCoverage = false,
): string {
  return /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    #define ${MODE_DEFINES[mode]}
    ${getLookupDefines(lookups)}
    ${withCoverage ? '#define COVERAGE' : ''}

    uniform sampler3D volume;
    uniform sampler3D coverage; // cf. \`VolumeVis\`
    uniform sampler2D colorMap;
    uniform vec3 stepDims; // voxels per side for the step size: more along non-uniform axes

    uniform float domainMin;
    uniform float oneOverRange;
    uniform float gammaExponent;
    uniform float symlogConstant;
    uniform float normRevertFactor;
    uniform float valueOffset;

    uniform float samplesPerVoxel;
    uniform float opacity;
    uniform float threshold;

    // Depth of opaque surfaces rendered before the volume (cf. \`SurfaceDepthPass\`)
    uniform bool hasSurfaceDepth;
    uniform sampler2D surfaceDepth;
    uniform vec2 depthTexelSize;
    uniform mat4 depthToBox; // NDC to box space (inverse model * camera world * inverse projection)

    in vec3 vPosition;
    flat in vec3 vOrigin;
    out vec4 fragColor;

    const float oneOverLog10 = 0.43429448190325176;
    const int MAX_STEPS = 4096;

    bool isSupported(float value) {
      return ${GLSL_IS_SUPPORTED[scaleType] || 'true'};
    }

    ${GLSL_LOG1P}

    float scale(float value) {
      return ${GLSL_SCALE[scaleType] || 'value'};
    }

    // Colors over [threshold, 1] (MIP, DVR): none spent on hidden values (cf. color bar)
    vec3 thresholdColor(float value) {
      float t = threshold < 1. ? (value - threshold) / (1. - threshold) : 1.;
      return texture(colorMap, vec2(t, 0.5)).rgb;
    }

    ${GLSL_TEX_COORDS}

    // Value and coverage at a position: coverage is 0 at NaN, else 1, unless a coverage texture
    // smooths the boundary of valid voxels (cf. \`VolumeVis\`). Then positions with coverage below
    // half are outside, and values next to NaN voxels are interpolated from valid voxels only,
    // weighted like trilinear filtering: the boundary is a smooth surface, not a staircase.
    vec2 sampleRaw(vec3 p) {
      vec3 coords = toTexCoords(p);
      #ifdef COVERAGE
        float c = texture(coverage, coords).r;
        if (c < 0.25) {
          return vec2(0., c); // outside, value not needed (cf. \`density\`, steps crossing the boundary)
        }
      #else
        float c = 1.;
      #endif

      float value = texture(volume, coords).r;
      if (!isnan(value)) {
        return vec2(value, c);
      }

      #ifdef COVERAGE
        ivec3 size = textureSize(volume, 0);
        vec3 pos = coords * vec3(size) - 0.5;
        vec3 f = fract(pos);
        ivec3 base = ivec3(floor(pos));
        float sum = 0.;
        float weight = 0.;
        for (int k = 0; k < 8; k++) {
          ivec3 corner = ivec3(k & 1, (k >> 1) & 1, k >> 2);
          float v = texelFetch(volume, clamp(base + corner, ivec3(0), size - 1), 0).r;
          if (!isnan(v)) {
            vec3 w = mix(1. - f, f, vec3(corner));
            sum += w.x * w.y * w.z * v;
            weight += w.x * w.y * w.z;
          }
        }
        // Without valid voxels around, coverage is below half anyway (cf. \`getCoverage\`)
        return weight > 0. ? vec2(sum / weight, c) : vec2(0.);
      #else
        return vec2(0.);
      #endif
    }

    // Normalized value in [0, 1], or -1 for values unsupported by the scale
    float normalizeValue(float raw) {
      float value = raw * normRevertFactor + valueOffset;
      if (isnan(value) || !isSupported(value)) {
        return -1.;
      }
      float scaledValue = scale(value);
      if (oneOverRange == 0.) {
        // Empty domain: step at the domain bound, consistently with the colour bar
        return scaledValue >= domainMin ? 1. : 0.;
      }
      return pow(clamp(oneOverRange * (scaledValue - domainMin), 0., 1.), gammaExponent);
    }

    // Normalized value, or -1 outside valid voxels and for unsupported values
    float sampleVolume(vec3 p) {
      vec2 s = sampleRaw(p);
      return s.y < 0.5 ? -1. : normalizeValue(s.x);
    }

    // Normalized value faded out across the boundary of valid voxels, for smooth normals there
    float density(vec3 p) {
      vec2 s = sampleRaw(p);
      return max(normalizeValue(s.x), 0.) * smoothstep(0.25, 0.75, s.y);
    }

    // Gradient of the normalized field, in voxel units (central differences)
    vec3 gradient(vec3 p) {
      vec3 d = 1. / dims;
      return 0.5 * vec3(
        density(p + vec3(d.x, 0., 0.)) - density(p - vec3(d.x, 0., 0.)),
        density(p + vec3(0., d.y, 0.)) - density(p - vec3(0., d.y, 0.)),
        density(p + vec3(0., 0., d.z)) - density(p - vec3(0., 0., d.z))
      );
    }

    // Fraction of a step inside valid voxels (coverage >= 0.5), from the coverage at both ends:
    // the boundary is crossed at the same depth whatever the jitter of the samples
    float coveredFraction(float c0, float c1) {
      if (min(c0, c1) >= 0.5) {
        return 1.;
      }
      if (max(c0, c1) < 0.5) {
        return 0.;
      }
      float t = (0.5 - c0) / (c1 - c0);
      return c1 >= 0.5 ? 1. - t : t;
    }

    // Two-sided Blinn-Phong with a headlight; shading fades out in homogeneous
    // regions (i.e. where the gradient is too weak to give meaningful normals)
    vec3 shade(vec3 color, vec3 grad, vec3 viewDir, float minGradient) {
      float len = length(grad);
      if (len < 1e-6) {
        return color;
      }
      float nDotV = abs(dot(grad / len, viewDir));
      vec3 lit = color * (0.3 + 0.8 * nDotV) + 0.3 * pow(nDotV, 48.);
      return mix(color, lit, smoothstep(0., minGradient, len));
    }

    vec2 intersectBox(vec3 origin, vec3 dir) {
      vec3 invDir = 1. / dir;
      vec3 t0 = -origin * invDir;
      vec3 t1 = (1. - origin) * invDir;
      vec3 tMin = min(t0, t1);
      vec3 tMax = max(t0, t1);
      return vec2(max(max(tMin.x, tMin.y), tMin.z), min(min(tMax.x, tMax.y), tMax.z));
    }

    void main() {
      vec3 origin = vOrigin + 0.5;
      vec3 dir = normalize(vPosition - vOrigin);

      vec2 bounds = intersectBox(origin, dir);
      bounds.x = max(bounds.x, 0.);

      // Stop rays at the nearest opaque surface: only the volume in front of it is accumulated
      if (hasSurfaceDepth) {
        vec2 uv = gl_FragCoord.xy * depthTexelSize;
        float depth = texture(surfaceDepth, uv).r;
        if (depth < 1.) {
          vec4 hit = depthToBox * vec4(uv * 2. - 1., depth * 2. - 1., 1.);
          vec3 hitPoint = hit.xyz / hit.w + 0.5; // texture space
          bounds.y = min(bounds.y, dot(hitPoint - origin, dir));
        }
      }

      if (bounds.x >= bounds.y) {
        discard;
      }

      vec3 voxelDir = dir * dims;
      vec3 viewDir = -normalize(voxelDir);
      float rayLength = bounds.y - bounds.x;
      float dt = 1. / (length(dir * stepDims) * samplesPerVoxel); // finer across narrow voxels
      int steps = int(ceil(rayLength / dt));
      if (steps > MAX_STEPS) {
        // Stretch steps so the samples still span the whole ray
        steps = MAX_STEPS;
        dt = rayLength / float(MAX_STEPS);
      }

      // Interleaved gradient noise
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec3 p = origin + dir * (bounds.x + jitter * dt);
      vec3 delta = dir * dt;

      #if defined(MODE_MIP)
        float maxValue = -1.;
        for (int i = 0; i < steps; i++) {
          maxValue = max(maxValue, sampleVolume(p));
          if (maxValue >= 1.) {
            break;
          }
          p += delta;
        }
        if (maxValue < threshold) {
          discard;
        }
        fragColor = vec4(thresholdColor(maxValue), 1.);

      #elif defined(MODE_DVR)
        // Opacity correction so that the result does not depend on the sampling rate
        float alphaExponent = dt * length(voxelDir); // voxels per step
        float oneOverRamp = 1. / max(1. - threshold, 1e-6);
        vec4 acc = vec4(0.);

        #ifdef COVERAGE
          vec2 prev = sampleRaw(p);
        #endif

        for (int i = 0; i < steps; i++) {
          vec2 s = sampleRaw(p);
          #ifdef COVERAGE
            // Steps crossing the boundary count partly, with the value and normal of their end inside
            float covered = coveredFraction(prev.y, s.y);
            bool isInside = s.y >= 0.5;
            vec2 inside = isInside ? s : prev;
            vec3 insideP = isInside ? p : p - delta;
            prev = s;
          #else
            float covered = s.y;
            vec2 inside = s;
            vec3 insideP = p;
          #endif
          float value = covered > 0. ? normalizeValue(inside.x) : -1.;
          if (value > threshold) {
            float voxelAlpha = clamp(opacity * (value - threshold) * oneOverRamp, 0., 0.999);
            float alpha = 1. - pow(1. - voxelAlpha, alphaExponent * covered);
            vec3 color = thresholdColor(value);
            if (voxelAlpha > 0.002) {
              // Skip costly gradient for nearly transparent samples (independently of sampling rate)
              color = shade(color, gradient(insideP), viewDir, 0.01);
            }
            acc += (1. - acc.a) * vec4(color * alpha, alpha);
            if (acc.a > 0.98) {
              break;
            }
          }
          p += delta;
        }
        if (acc.a < 0.002) {
          discard;
        }
        fragColor = acc; // premultiplied

      #else
        vec3 prev = p;
        for (int i = 0; i < steps; i++) {
          if (sampleVolume(p) > threshold) {
            // Refine hit point with a few bisection steps
            vec3 lo = prev;
            vec3 hi = p;
            for (int j = 0; j < 6; j++) {
              vec3 mid = 0.5 * (lo + hi);
              if (sampleVolume(mid) > threshold) {
                hi = mid;
              } else {
                lo = mid;
              }
            }
            vec3 color = texture(colorMap, vec2(threshold, 0.5)).rgb;
            fragColor = vec4(shade(color, gradient(hi), viewDir, 1e-6), 1.);
            return;
          }
          prev = p;
          p += delta;
        }
        discard;
      #endif
    }
  `;
}
