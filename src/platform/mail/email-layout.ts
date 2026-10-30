/**
 * The branded HTML shell every Zeyoo email is sent in. Table layout and inline styles
 * because mail clients ignore stylesheets and most of modern CSS. Images are hosted on
 * the web app, so the logo is fetched from APP_WEB_URL rather than attached.
 */

const BRAND_GREEN = '#00E37D';
const INK = '#0B0D0C';
const MUTED = '#5F6764';
const SURFACE = '#F4F6F5';
const BORDER = '#E3E7E5';
const FONT = "'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

export interface EmailAction {
  /** The button text, e.g. "View campaign". */
  label: string;
  /**
   * Absolute https URL, or a path on the web app (resolved against APP_WEB_URL). Either
   * way it opens the app when installed and the website otherwise.
   */
  url: string;
}

export interface EmailContent {
  /** Shown in the inbox list after the subject, and hidden in the email itself. */
  preheader: string;
  title: string;
  /** Plain-text paragraphs; each is escaped, so callers never pass HTML. */
  paragraphs: string[];
  action?: EmailAction;
  /** Pre-rendered, trusted HTML placed after the paragraphs (e.g. a sign-in code). */
  highlightHtml?: string;
  /** Why the recipient got this email; plain text. */
  footnote: string;
  /** Link to manage email preferences; omitted for mail the recipient asked for. */
  preferencesUrl?: string;
}

export function renderEmail(appWebUrl: string, content: EmailContent): string {
  const base = appWebUrl.replace(/\/$/, '');
  const paragraphs = content.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font:16px/24px ${FONT};color:${INK}">${escapeHtml(text)}</p>`,
    )
    .join('');
  const action = content.action
    ? renderAction({
        ...content.action,
        url: content.action.url.startsWith('/') ? `${base}${content.action.url}` : content.action.url,
      })
    : '';
  const preferences = content.preferencesUrl
    ? ` <a href="${escapeHtml(content.preferencesUrl)}" style="color:${MUTED};text-decoration:underline">Manage email notifications</a>.`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
<a href="${escapeHtml(base)}" style="text-decoration:none"><img src="${escapeHtml(`${base}/brand/wordmark.png`)}" width="112" height="29" alt="Zeyoo" style="display:block;border:0"></a>
</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid ${BORDER};border-radius:16px;padding:32px 28px">
<div style="width:40px;height:4px;border-radius:2px;background:${BRAND_GREEN};margin:0 0 20px"></div>
<h1 style="margin:0 0 16px;font:700 22px/28px ${FONT};color:${INK}">${escapeHtml(content.title)}</h1>
${paragraphs}${content.highlightHtml ?? ''}${action}
</td></tr>
<tr><td style="padding:20px 4px 0;font:13px/20px ${FONT};color:${MUTED}">
${escapeHtml(content.footnote)}${preferences}<br>
Zeyoo · Get paid to create. Get campaigns done.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The sign-in code, set large and spaced so it reads (and copies) at a glance. */
export function renderCode(code: string): string {
  return `<div style="margin:8px 0 20px;padding:18px 0;background:${SURFACE};border-radius:12px;text-align:center;font:700 32px/36px 'JetBrains Mono',Menlo,Consolas,monospace;letter-spacing:8px;color:${INK}">${escapeHtml(code)}</div>`;
}

function renderAction(action: EmailAction): string {
  const url = escapeHtml(action.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>
<td style="border-radius:12px;background:${BRAND_GREEN}">
<a href="${url}" style="display:inline-block;padding:14px 24px;font:600 16px/20px ${FONT};color:${INK};text-decoration:none;border-radius:12px">${escapeHtml(action.label)}</a>
</td></tr></table>
<p style="margin:0;font:13px/20px ${FONT};color:${MUTED}">Button not working? Open this link:<br><a href="${url}" style="color:${MUTED};word-break:break-all">${escapeHtml(action.url)}</a></p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
