import { describe, expect, it } from 'vitest';

import { formatUnits } from './units';

describe('formatUnits', () => {
  it('should format temperatures', () => {
    for (const units of ['degC', 'deg_C', 'degree_Celsius', 'celsius']) {
      expect(formatUnits(units)).toBe('°C');
    }
    expect(formatUnits('degF')).toBe('°F');
  });

  it('should format compass and plain degrees', () => {
    for (const units of [
      'degrees_east',
      'degree_east',
      'degree_E',
      'degrees_E',
      'degreeE',
    ]) {
      expect(formatUnits(units)).toBe('°E');
    }
    expect(formatUnits('degrees_north')).toBe('°N');
    expect(formatUnits('degree_N')).toBe('°N');
    expect(formatUnits('degrees_west')).toBe('°W');
    expect(formatUnits('degreesS')).toBe('°S');
    expect(formatUnits('degree')).toBe('°');
    expect(formatUnits('degrees')).toBe('°');
  });

  it('should format powers and multipliers', () => {
    expect(formatUnits('m s-1')).toBe('m s⁻¹');
    expect(formatUnits('kg m-2')).toBe('kg m⁻²');
    expect(formatUnits('m2')).toBe('m²');
    expect(formatUnits('m^2')).toBe('m²');
    expect(formatUnits('m^-2')).toBe('m⁻²');
    expect(formatUnits('m**2')).toBe('m²');
    expect(formatUnits('W m-2 sr-1')).toBe('W m⁻² sr⁻¹');
    expect(formatUnits('kg.m-2')).toBe('kg·m⁻²');
    expect(formatUnits('10^-3 m')).toBe('10⁻³ m');
    expect(formatUnits('mol CO2 m-2 s-1')).toBe('mol CO2 m⁻² s⁻¹'); // not CO²
    expect(formatUnits('ug PM10 m-3')).toBe('ug PM10 m⁻³');
    expect(formatUnits('km2')).toBe('km²');
  });

  it('should format percent and dimensionless units', () => {
    expect(formatUnits('percent')).toBe('%');
    expect(formatUnits('1')).toBe('');
  });

  it('should keep other units as is', () => {
    for (const units of [
      'months since 2026-01-01',
      's since 2026-01-01 00:00:00',
      'a.u.',
      '1/Å',
      'a₀',
      'counts',
      'dB',
      'Hz',
      'K',
      'kpc',
      'cell',
      'm/s',
      '%',
      '°C',
      'toString',
      '',
      'a.u',
      'arb.units',
      'm^',
      'm**',
      'pixel2',
      'ch1',
    ]) {
      expect(formatUnits(units)).toBe(units);
    }
  });
});
