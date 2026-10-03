/**
 * Where uploaded image bytes live. UploadsService depends on this port, never on a
 * concrete store, so tests can swap in a fake and the provider can change without
 * touching the controller or clients.
 */
export abstract class ImageStorage {
  /** Stores the bytes under `key`; the public URL is built from the key by the caller. */
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
}
