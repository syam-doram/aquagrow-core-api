export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        tenantId?: string;
        shopId?: string;
        branchId?: string;
        [key: string]: any;
      };
    }
  }
}
