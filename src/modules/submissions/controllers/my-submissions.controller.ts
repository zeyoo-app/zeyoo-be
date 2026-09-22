import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Submission } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { SubmissionService } from '../services/submission.service';

@ApiTags('submissions')
@ApiBearerAuth()
@RequirePermission(Permission.ContentSubmit)
@Controller('me/submissions')
export class MySubmissionsController {
  constructor(private readonly submissions: SubmissionService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<Submission[]> {
    return this.submissions.listOwn(principal.userId);
  }
}
