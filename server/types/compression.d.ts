declare module "compression" {
  import type { RequestHandler } from "express";

  interface CompressionOptions {
    level?: number;
    threshold?: number | string;
    filter?: (req: unknown, res: unknown) => boolean;
    [key: string]: unknown;
  }

  function compression(options?: CompressionOptions): RequestHandler;
  export default compression;
}
