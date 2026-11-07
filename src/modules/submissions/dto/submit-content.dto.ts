import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X']);

const postSchema = z.object({
  platform: platformSchema,
  url: z.string().url(),
});

export const submitContentSchema = z
  .object({
    contentType: z.enum(['LINK', 'UPLOAD']),
    // The uploaded video for UPLOAD. For LINK, older clients send their one post link
    // here instead of `posts`; the service treats it as a single post.
    contentUrl: z.string().url().optional(),
    // LINK only: one published post per campaign platform the creator posted on.
    posts: z.array(postSchema).min(1).max(5).optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((value) => value.contentType === 'UPLOAD' || Boolean(value.posts ?? value.contentUrl), {
    message: 'Add the link to at least one post.',
    path: ['posts'],
  })
  .refine((value) => value.contentType === 'LINK' || Boolean(value.contentUrl), {
    message: 'Upload your video before submitting.',
    path: ['contentUrl'],
  })
  .refine((value) => value.contentType === 'LINK' || !value.posts, {
    message: 'Post links are only sent with a LINK submission.',
    path: ['posts'],
  })
  .refine(
    (value) =>
      new Set(value.posts?.map((post) => post.platform)).size === (value.posts?.length ?? 0),
    { message: 'Add one link per platform.', path: ['posts'] },
  );

export class SubmitContentDto extends createZodDto(submitContentSchema) {}
