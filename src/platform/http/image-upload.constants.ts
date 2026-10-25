/** Hard ceiling for a single uploaded image. Enforced by multer while streaming. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Ceiling for a creator's submission video, uploaded straight to storage. */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
