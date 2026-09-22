import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Category } from '@prisma/client';
import { CategoryService } from '../services/category.service';

@ApiTags('campaign-categories')
@ApiBearerAuth()
@Controller('campaign-categories')
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  list(): Promise<Category[]> {
    return this.categories.list();
  }
}
