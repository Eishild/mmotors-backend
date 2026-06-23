import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export type ApiResponse<T = unknown> = {
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
};
