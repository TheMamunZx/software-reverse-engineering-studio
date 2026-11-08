export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: unknown) => Promise<void>): void;
  send(message: unknown): Promise<void>;
}

export interface TransportConfig {
  type: 'stdio';
}