import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { SubmissionService, SubmissionWithRevisions } from '../services/submission.service';

@ApiTags('submissions')
@ApiBearerAuth()
@RequirePermission(Permission.ContentSubmit)
@Controller('me/submissions')
export class MySubmissionsController {
  constructor(private readonly submissions: SubmissionService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<SubmissionWithRevisions[]> {
    return this.submissions.listOwn(principal.userId);
  }
}
