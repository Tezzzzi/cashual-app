import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function getDirname(): string {
  // import.meta.dirname is only available in Node 21.2+
  // Use fileURLToPath as fallback for older Node versions
  if (typeof import.meta.dirname !== "undefined") {
    return import.meta.dirname;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

export function serveStatic(app: Express) {
  const dirname = getDirname();
  // In production, dist/index.js is at /app/dist/index.js
  // and frontend is built to /app/dist/public/
  // So we resolve relative to the current file's directory
  const distPath = path.resolve(dirname, "public");

  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
    // Try alternative path
    const altPath = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(altPath)) {
      console.log(`Using alternative path: ${altPath}`);
      app.use(express.static(altPath));
      app.use("*", (_req, res) => {
        res.sendFile(path.resolve(altPath, "index.html"));
      });
      return;
    }
  }

  console.log(`Serving static files from: ${distPath}`);
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
