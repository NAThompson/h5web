export enum VectorStyle {
  Arrows = 'arrows',
  Streamlines = 'streamlines',
  Lic = 'lic', // line integral convolution
}

export enum VectorBackground {
  Magnitude = 'magnitude',
  None = 'none',
  Divergence = 'divergence',
  Curl = 'curl', // scalar vorticity in 2D
  Dataset = 'dataset', // scalar dataset named by the file
}

export const DEFAULT_ARROW_DENSITY = 3; // arrows per 100 CSS pixels
