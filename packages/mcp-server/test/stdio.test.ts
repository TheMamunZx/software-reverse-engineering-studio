import { describe, expect, it } from 'vitest';
import { createStdioTransport } from '../src/transport/stdio.js';

describe('MCP Server — stdio transport', () => {
  it('creates stdio transport instance', () => {
    const transport = createStdioTransport();
    expect(transport).toBeDefined();
    expect(typeof transport.start).toBe('function');
    expect(typeof transport.stop).toBe('function');
    expect(typeof transport.onMessage).toBe('function');
    expect(typeof transport.send).toBe('function');
  });

  it('send serializes message to JSON', async () => {
    const transport = createStdioTransport();
    const sent: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string) => {
      sent.push(chunk);
      return true;
    };

    try {
      await transport.send({ jsonrpc: '2.0', method: 'test', params: {} });
      expect(sent.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(sent[sent.length - 1].trim());
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.method).toBe('test');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
