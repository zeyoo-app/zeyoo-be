import { Injectable, NotFoundException } from '@nestjs/common';
import { Category } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';

const SLUG_SUFFIX_BYTES = 3;

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  create(name: string): Promise<Category> {
    return this.prisma.category.create({ data: { name, slug: this.slugify(name) } });
  }

  async assertExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base || 'category'}-${randomBytes(SLUG_SUFFIX_BYTES).toString('hex')}`;
  }
}
