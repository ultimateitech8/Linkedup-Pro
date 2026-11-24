import { BadRequestException, type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { z } from 'zod';
import { appOrigin, auth, canUseAccount } from './database.js';

export const positiveId = z.coerce.number().int().positive().max(2147483647);

export function read<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.issues[0]?.message ?? 'Check the fields and try again.');
  return result.data;
}

export async function currentUser(request: Request) {
  const user = (await auth.api.getSession({ headers: fromNodeHeaders(request.headers) }))?.user;
  return user && canUseAccount(user) ? user : undefined;
}

export async function requireUser(request: Request) {
  const origin = request.get('origin');
  if (origin && origin !== appOrigin) throw new ForbiddenException('This request came from a different site.');
  const user = await currentUser(request);
  if (!user) throw new UnauthorizedException('Sign in to continue.');
  return user;
}

@Injectable()
export class MemberUploadGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    await requireUser(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
