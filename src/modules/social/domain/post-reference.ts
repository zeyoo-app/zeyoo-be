import { SocialPlatform } from '@prisma/client';

/** A published post, identified well enough for a platform adapter to look it up. */
export interface PostReference {
  platform: SocialPlatform;
  /** The platform's own id, or the URL shortcode for Instagram (resolved by the adapter). */
  postId: string;
  url: string;
}

const YOUTUBE_ID = '[\\w-]{11}';

interface UrlRule {
  platform: SocialPlatform;
  hosts: RegExp;
  path: RegExp;
}

const URL_RULES: UrlRule[] = [
  {
    platform: 'YOUTUBE',
    hosts: /(^|\.)youtube\.com$/,
    path: new RegExp(`^/(?:shorts|embed|live)/(${YOUTUBE_ID})`),
  },
  { platform: 'TIKTOK', hosts: /(^|\.)tiktok\.com$/, path: /^\/@[^/]+\/video\/(\d+)/ },
  {
    platform: 'INSTAGRAM',
    hosts: /(^|\.)instagram\.com$/,
    path: /^\/(?:[^/]+\/)?(?:reels?|p|tv)\/([\w-]+)/,
  },
  { platform: 'X', hosts: /(^|\.)(x|twitter)\.com$/, path: /^\/[^/]+\/status\/(\d+)/ },
  { platform: 'SNAPCHAT', hosts: /(^|\.)snapchat\.com$/, path: /^\/spotlight\/([\w-]+)/ },
];

/**
 * Recognises a creator-submitted link and extracts the platform's post id. Returns
 * null for anything else (including short-link redirectors such as vm.tiktok.com,
 * which cannot be resolved without a network call).
 */
export function parsePostUrl(rawUrl: string): PostReference | null {
  const url = toUrl(rawUrl);
  if (!url) {
    return null;
  }
  const youtubeId = youtubeIdFrom(url);
  if (youtubeId) {
    return { platform: 'YOUTUBE', postId: youtubeId, url: rawUrl };
  }
  for (const rule of URL_RULES) {
    const match = rule.hosts.test(url.hostname) ? rule.path.exec(url.pathname) : null;
    if (match) {
      return { platform: rule.platform, postId: match[1], url: rawUrl };
    }
  }
  return null;
}

function toUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim());
  } catch {
    return null;
  }
}

function youtubeIdFrom(url: URL): string | null {
  const idPattern = new RegExp(`^${YOUTUBE_ID}$`);
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1);
    return idPattern.test(id) ? id : null;
  }
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return idPattern.test(id) ? id : null;
  }
  return null;
}
