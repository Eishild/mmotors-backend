import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export type ApiResponse<T = unknown> = {
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
};
