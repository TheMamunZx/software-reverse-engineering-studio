import chalk from 'chalk';
import yaml from 'js-yaml';

export type OutputFormat = 'json' | 'table' | 'markdown' | 'yaml';

export interface FormatterOptions {
  format: OutputFormat;
  color?: boolean;
}

export class OutputFormatter {
  private options: FormatterOptions;

  constructor(options: FormatterOptions) {
    this.options = { color: true, ...options };
  }

  format(data: unknown): string {
    switch (this.options.format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'yaml':
        return this.toYaml(data);
      case 'table':
        return this.toTable(data);
      case 'markdown':
        return this.toMarkdown(data);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  private toYaml(data: unknown): string {
    return yaml.dump(data, { indent: 2, noRefs: true });
  }

  private toTable(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return 'No data';
    }

    const first = data[0] as Record<string, unknown>;
    const columns = Object.keys(first);

    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const col of columns) {
      widths[col] = Math.max(col.length, 10);
    }

    for (const row of data) {
      for (const col of columns) {
        const val = String(row[col] ?? '');
        widths[col] = Math.max(widths[col] ?? col.length, val.length);
      }
    }

    const maxWidth = 80;
    const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0) + columns.length + 1;

    if (totalWidth > maxWidth) {
      // Truncate long columns
      for (const col of columns) {
        widths[col] = Math.min(widths[col] ?? 30, 30);
      }
    }

    const header = '| ' + columns.map(c => c.padEnd(widths[c] ?? 0)).join(' | ') + ' |';
    const separator = '| ' + columns.map(c => '-'.repeat(widths[c] ?? 0)).join(' | ') + ' |';
    const rows = data.map(row =>
      '| ' + columns.map(c => String(row[c] ?? '').slice(0, widths[c] ?? 0).padEnd(widths[c] ?? 0)).join(' | ') + ' |'
    ).join('\n');

    return [header, separator, rows].join('\n');
  }

  private toMarkdown(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return 'No data';
    }

    const first = data[0] as Record<string, unknown>;
    const columns = Object.keys(first);

    const header = '| ' + columns.join(' | ') + ' |';
    const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const rows = data.map(row =>
      '| ' + columns.map(c => String(row[c] ?? '')).join(' | ') + ' |'
    ).join('\n');

    return [header, separator, rows].join('\n');
  }
}

export function createFormatter(format: OutputFormat, color = true): OutputFormatter {
  return new OutputFormatter({ format, color });
}