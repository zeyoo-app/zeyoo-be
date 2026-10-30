/**
 * Paths into the Zeyoo apps. Each is a real page on the web app (APP_WEB_URL), and the
 * mobile app claims the same https URLs as universal / App Links and maps them onto its
 * own screens, so one link opens the app when it is installed and the website when not.
 * Notifications store the path; emails and pushes turn it into an absolute URL.
 */
export const AppPaths = {
  signIn: '/sign-in',
  notifications: '/notifications',
  brandCampaign: (campaignId: string): string => `/brand/campaigns/${campaignId}`,
  brandSubscription: '/brand/subscription',
  brandPaymentMethod: '/brand/payment-method',
  creatorCampaign: (campaignId: string): string => `/creator/campaigns/${campaignId}`,
  creatorCampaignSubmissions: (campaignId: string): string =>
    `/creator/campaigns/${campaignId}/submissions`,
  creatorWallet: '/creator/wallet',
  creatorProfile: '/creator/profile',
  creatorPayoutMethod: '/creator/payout-method',
  dispute: (disputeId: string): string => `/disputes/${disputeId}`,
  adminDisputes: '/admin/disputes',
} as const;

/** Which client started a hosted (Stripe) flow, and so where its return page should lead. */
export type ReturnClient = 'web' | 'app';

/** An absolute link to a path on the web app. */
export function appUrl(appWebUrl: string, path: string): string {
  return `${appWebUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Where a hosted flow returns to. The web app goes straight to the page; the mobile app
 * goes through /app-return, which hands the path back to the app over its zeyoo:// scheme
 * (a redirect inside the browser does not trigger a universal link on its own).
 */
export function returnUrl(appWebUrl: string, path: string, client: ReturnClient): string {
  return client === 'app'
    ? appUrl(appWebUrl, `/app-return?to=${encodeURIComponent(path)}`)
    : appUrl(appWebUrl, path);
}
