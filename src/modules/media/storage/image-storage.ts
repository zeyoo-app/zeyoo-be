/**
 * Where uploaded media bytes live (images, and creators' submission videos). Services
 * depend on this port, never on a concrete store, so tests can swap in a fake and the
 * provider can change without touching the controllers or clients.
 */
export abstract class ImageStorage {
  /** Stores the bytes under `key`; the public URL is built from the key by the caller. */
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  /**
   * A short-lived URL the client PUTs the file to directly, so large videos never pass
   * through the API. The signature pins the content type and exact size.
   */
  abstract presignPut(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds: number,
  ): Promise<string>;

  /** What is actually stored under `key`, or null when nothing was uploaded. */
  abstract stat(key: string): Promise<{ size: number; contentType: string | null } | null>;
}
