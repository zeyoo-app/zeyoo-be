import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { OrganizationService, UserService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { WalletService } from '@modules/payments/payments.public';
import { PlatformConnectionService } from '@modules/social/social.public';

/**
 * Deletes a person's account on request. Money and live work are checked first, so
 * deletion can never strand a balance or abandon a funded campaign; then personal
 * data is erased module by module and the user row is anonymized last, which makes
 * a half-finished attempt safe to retry.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly users: UserService,
    private readonly organizations: OrganizationService,
    private readonly campaigns: CampaignService,
    private readonly wallet: WalletService,
    private readonly profiles: CreatorProfileService,
    private readonly notifications: NotificationService,
    private readonly connections: PlatformConnectionService,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.status === 'DELETED') {
      throw new NotFoundException('Account not found.');
    }
    await this.assertNothingOutstanding(userId);

    await this.profiles.anonymize(userId);
    await this.connections.disconnectAll(userId);
    await this.notifications.deleteAllFor(userId);
    await this.users.anonymize(userId);
  }

  private async assertNothingOutstanding(userId: string): Promise<void> {
    const wallet = await this.wallet.getWallet(userId);
    const owedMinor =
      wallet.available.minorUnits + wallet.pending.minorUnits + wallet.held.minorUnits;
    if (owedMinor > 0) {
      throw new ConflictException(
        'You still have a balance or a withdrawal in progress. Withdraw it before deleting your account.',
      );
    }
    const organizations = await this.organizations.listForUser(userId);
    const hasLive = await this.campaigns.hasLiveCampaigns(
      organizations.map((organization) => organization.id),
    );
    if (hasLive) {
      throw new ConflictException('Close your live campaigns before deleting your account.');
    }
  }
}
