/**
 * Bridge connection types
 */

/**
 * E2E encryption interface
 */
export interface E2EInterface {
  init(): void;
  isEnabled(): boolean;
  isReady(): boolean;
  createKeyExchangeMessage(needsResponse: boolean): Record<string, unknown>;
  handleKeyExchange(msg: Record<string, unknown>): boolean;
  encrypt(data: unknown): unknown;
  decrypt(data: unknown): unknown;
}
