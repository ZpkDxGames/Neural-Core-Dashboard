export function strictJSON(bytes: Uint8Array): Record<string, unknown>;
export function fields(
  value: unknown,
  allowed: string[],
  required?: string[],
): Record<string, unknown>;
export function query(
  target: string,
  allowed: string[],
  repeated?: string[],
): URLSearchParams;
export function pageQuery(
  target: string,
  proposals?: boolean,
): Record<string, unknown>;
export function readBytes(
  stream: AsyncIterable<Uint8Array>,
  max?: number,
): Promise<Buffer>;
