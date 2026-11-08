import type { Transport } from './transport.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('stdio-transport');

export class StdioTransport implements Transport {
  private messageHandler: ((message: unknown) => Promise<void>) | null = null;
  private buffer = '';
  private started = false;

  start(): Promise<void> {
    if (this.started) return Promise.resolve();

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => this.handleData(chunk));
    process.stdin.on('end', () => this.handleEnd());
    process.stdin.on('error', (err) => logger.error({ err }, 'Stdin error'));

    this.started = true;
    logger.info('Stdio transport started');
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.started = false;
    return Promise.resolve();
  }

  onMessage(handler: (message: unknown) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(message: unknown): Promise<void> {
    const json = JSON.stringify(message);
    process.stdout.write(json + '\n');
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        this.handleLine(line);
      }
    }
  }

  private handleEnd(): void {
    if (this.buffer.trim() && this.messageHandler) {
      this.handleLine(this.buffer);
    }
    this.buffer = '';
  }

  private async handleLine(line: string): Promise<void> {
    try {
      const message = JSON.parse(line);
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
    } catch (error) {
      logger.error({ line, error: error instanceof Error ? error.message : String(error) }, 'Failed to parse message');
    }
  }
}

export function createStdioTransport(): StdioTransport {
  return new StdioTransport();
}