declare module "next/server" {
  export const NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => unknown;
  };
}

declare module "next" {}
declare module "next/image-types/global" {}
