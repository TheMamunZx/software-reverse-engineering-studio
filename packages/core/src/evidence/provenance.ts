export interface ProvenanceBuilder {
  build(input: {
    derivedFrom: string[];
    tool: string;
    command: string;
    parameters: Record<string, unknown>;
    duration: number;
    toolVersion: string;
  }): {
    derivedFrom: string[];
    tool: string;
    command: string;
    parameters: Record<string, unknown>;
    duration: number;
    toolVersion: string;
  };
}

export function createProvenanceBuilder(): ProvenanceBuilder {
  return {
    build(input) {
      return input;
    }
  };
}