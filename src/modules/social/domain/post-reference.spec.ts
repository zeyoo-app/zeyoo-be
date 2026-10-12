import { parsePostUrl } from './post-reference';

describe('parsePostUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'YOUTUBE', 'dQw4w9WgXcQ'],
    [
      'https://www.tiktok.com/@creator.name/video/7234567890123456789',
      'TIKTOK',
      '7234567890123456789',
    ],
    ['https://www.instagram.com/reel/C8aBcDeFgHi/', 'INSTAGRAM', 'C8aBcDeFgHi'],
    ['https://www.instagram.com/creator/reel/C8aBcDeFgHi/', 'INSTAGRAM', 'C8aBcDeFgHi'],
    ['https://www.instagram.com/p/C8aBcDeFgHi/?img_index=1', 'INSTAGRAM', 'C8aBcDeFgHi'],
    ['https://x.com/creator/status/1790000000000000000', 'X', '1790000000000000000'],
    ['https://twitter.com/creator/status/1790000000000000000', 'X', '1790000000000000000'],
    [
      'https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYdmFxcnZyY',
      'SNAPCHAT',
      'W7_EDlXWTBiXAEEniNoMPwAAYdmFxcnZyY',
    ],
  ])('recognises %s', (url, platform, postId) => {
    expect(parsePostUrl(url)).toMatchObject({ platform, postId, url });
  });

  it.each([
    'not a url',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/channel/UC1234567890',
    'https://vm.tiktok.com/ZMabcdef/',
    'https://www.instagram.com/creator/',
  ])('returns null for %s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});
