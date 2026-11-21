import { submitContentSchema } from './submit-content.dto';

const video = 'https://media.zeyoo.app/uploads/video-1.mp4';
const post = { platform: 'TIKTOK' as const, url: 'https://www.tiktok.com/@layla/video/1' };

describe('submitContentSchema', () => {
  it('takes post links on their own', () => {
    expect(submitContentSchema.safeParse({ contentType: 'LINK', posts: [post] }).success).toBe(true);
  });

  it('takes a video together with its post links', () => {
    const result = submitContentSchema.safeParse({
      contentType: 'UPLOAD',
      contentUrl: video,
      posts: [post],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a video without any post link', () => {
    const result = submitContentSchema.safeParse({ contentType: 'UPLOAD', contentUrl: video });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Add the link to at least one post.');
  });

  it('refuses an upload submission with links but no video', () => {
    const result = submitContentSchema.safeParse({ contentType: 'UPLOAD', posts: [post] });
    expect(result.success).toBe(false);
  });

  it('still takes an older client sending one link as contentUrl', () => {
    const result = submitContentSchema.safeParse({ contentType: 'LINK', contentUrl: post.url });
    expect(result.success).toBe(true);
  });

  it('takes a post on each of six platforms', () => {
    const posts = ['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X', 'FACEBOOK'].map((platform) => ({
      platform,
      url: `https://example.com/${platform}`,
    }));
    expect(submitContentSchema.safeParse({ contentType: 'LINK', posts }).success).toBe(true);
  });
});
