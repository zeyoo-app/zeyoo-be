import { Body, Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './delete-account.dto';

@ApiTags('account')
@ApiBearerAuth()
@Controller('me/account')
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  async deleteAccount(
    @CurrentUser() principal: Principal,
    // Validated by the pipe: the request is rejected unless it carries the typed confirmation.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _confirmation: DeleteAccountDto,
  ): Promise<void> {
    await this.deletion.deleteAccount(principal.userId);
  }
}
