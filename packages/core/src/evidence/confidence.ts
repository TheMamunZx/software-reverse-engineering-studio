import type { ConfidenceScore, ConfidenceFactor } from '../types/evidence.js';

export interface ConfidenceCalculator {
  calculate(factors: ConfidenceFactor[]): ConfidenceScore;
}

export function createConfidenceCalculator(): ConfidenceCalculator {
  return {
    calculate(factors: ConfidenceFactor[]): ConfidenceScore {
      let value = 0.5;

      for (const factor of factors) {
        switch (factor.impact) {
          case 'positive':
            value += factor.weight * 0.15;
            break;
          case 'negative':
            value -= factor.weight * 0.2;
            break;
        }
      }

      value = Math.max(0, Math.min(1, value));

      let level: ConfidenceScore['level'];
      if (value >= 0.8) level = 'high';
      else if (value >= 0.5) level = 'medium';
      else if (value > 0) level = 'low';
      else level = 'none';

      return {
        level,
        value: Math.round(value * 100) / 100,
        justification: factors.map(f => `${f.name}: ${f.impact} (${f.description})`).join('; ') || 'No factors provided',
        factors
      };
    }
  };
}