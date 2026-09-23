import { Injectable } from '@nestjs/common';
import { Credential, User, UserStatus, UserType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';

interface CreateUserWithPassword {
  email: string;
  passwordHash: string;
  type: UserType;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  listAll(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  }

  setStatus(userId: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  findByEmailWithCredential(
    email: string,
  ): Promise<(User & { credential: Credential | null }) | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { credential: true },
    });
  }

  // New accounts start ACTIVE; email-verification gating is layered in once the
  // notifications module can deliver the verification message.
  createWithPassword(input: CreateUserWithPassword): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        type: input.type,
        status: 'ACTIVE',
        credential: { create: { passwordHash: input.passwordHash } },
      },
    });
  }
}
