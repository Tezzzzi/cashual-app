import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerTelegramRoutes } from "./telegram-routes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // BUG-08: Remove X-Powered-By header
  app.disable("x-powered-by");

  // REC-01: Security headers via helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // Telegram Mini App needs inline scripts
      crossOriginEmbedderPolicy: false, // Allow embedding in Telegram WebView
      crossOriginOpenerPolicy: false,
    })
  );

  // BUG-04: Gzip/Brotli compression
  app.use(compression());

  // BUG-01: Rate limiting on auth endpoint
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 attempts per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts, please try again later" },
  });

  // General API rate limiter
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });

  // Apply rate limiters
  app.use("/api/telegram/auth", authLimiter);
  app.use("/api/trpc", apiLimiter);

  // Configure body parser with larger size limit for file uploads
  // BUG-07: Custom JSON error handler returns JSON instead of HTML
  app.use(
    express.json({
      limit: "50mb",
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // BUG-07: Handle JSON parse errors and return JSON response
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err.type === "entity.parse.failed") {
        return res.status(400).json({
          error: "Invalid JSON",
          message: "The request body contains invalid JSON",
        });
      }
      next(err);
    }
  );

  // Telegram authentication routes
  registerTelegramRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // In production, serve static files. In dev, Vite is loaded separately.
  if (process.env.NODE_ENV !== "development") {
    serveStatic(app);
  } else {
    // Dynamic import to avoid bundling vite in production
    const viteMod = await import(/* @vite-ignore */ "./vite.js");
    await viteMod.setupVite(app, server);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
