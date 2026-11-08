import { describe, expect, it } from 'vitest';
import { createFormatter } from '../src/output/formatter.js';

describe('OutputFormatter', () => {
  const sampleData = [
    { id: '1', name: 'Alpha', count: 42 },
    { id: '2', name: 'Beta', count: 100 },
  ];

  it('formats data as JSON', () => {
    const formatter = createFormatter('json');
    const result = formatter.format(sampleData);
    expect(JSON.parse(result)).toEqual(sampleData);
  });

  it('formats data as YAML', () => {
    const formatter = createFormatter('yaml');
    const result = formatter.format(sampleData);
    expect(result).toContain('name: Alpha');
    expect(result).toContain('count: 42');
  });

  it('formats data as an ASCII/pipe table', () => {
    const formatter = createFormatter('table');
    const result = formatter.format(sampleData);
    expect(result).toContain('| id');
    expect(result).toContain('| Alpha');
    expect(result).toContain('| Beta');
  });

  it('formats data as GitHub Flavored Markdown table', () => {
    const formatter = createFormatter('markdown');
    const result = formatter.format(sampleData);
    expect(result).toContain('| id | name | count |');
    expect(result).toContain('| --- | --- | --- |');
    expect(result).toContain('| 1 | Alpha | 42 |');
  });

  it('handles empty or non-array inputs gracefully', () => {
    const formatter = createFormatter('table');
    expect(formatter.format([])).toBe('No data');
    expect(formatter.format(null)).toBe('No data');
  });
});

