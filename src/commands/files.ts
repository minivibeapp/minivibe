/**
 * File-related slash commands: /upload, /download, /files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import WebSocket from 'ws';

import { colors } from '../utils/colors';

// Maximum file size for upload (50MB)
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

/**
 * Get MIME type from filename
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Format file size for display
 */
export function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Wait for a specific message type from WebSocket
 */
function waitForMessage(
  ws: WebSocket,
  successType: string,
  errorContext: string,
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Timeout'));
    }, timeoutMs);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === successType) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(msg);
        } else if (msg.type === 'error' && msg.context === errorContext) {
          clearTimeout(timeout);
          ws.off('message', handler);
          reject(new Error(msg.message || `${errorContext} failed`));
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Sanitize and validate file path to prevent path traversal attacks
 * Returns the resolved path if valid, or null if the path is unsafe
 * All paths (relative or absolute) must resolve to within the base directory
 */
function sanitizePath(filePath: string, baseDir: string = process.cwd()): string | null {
  // Resolve to absolute path
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(baseDir, filePath);

  const normalizedBase = path.resolve(baseDir);
  const normalizedResolved = path.resolve(resolved);

  // All paths must be within the base directory (security: prevent access outside cwd)
  if (!normalizedResolved.startsWith(normalizedBase + path.sep) && normalizedResolved !== normalizedBase) {
    return null; // Path traversal attempt or absolute path outside cwd
  }

  return normalizedResolved;
}

/**
 * Sanitize filename to prevent path traversal in downloaded files
 * Removes directory components and dangerous characters
 */
function sanitizeFileName(fileName: string): string {
  // Get only the base name (removes any directory components)
  let sanitized = path.basename(fileName);

  // Remove any null bytes or other dangerous characters
  sanitized = sanitized.replace(/[\x00-\x1f]/g, '');

  // If the result is empty or just dots, use a safe default
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return 'downloaded_file';
  }

  return sanitized;
}

/**
 * /upload <path> - Upload file to cloud storage
 */
export async function slashCmdUpload(
  filePath: string | undefined,
  ws: WebSocket | null,
  log: (msg: string) => void
): Promise<void> {
  if (!filePath) {
    log(`\n${colors.yellow}Usage: /upload <path>${colors.reset}\n`);
    return;
  }

  // Resolve and sanitize path to prevent traversal attacks
  const fullPath = sanitizePath(filePath);
  if (!fullPath) {
    log(`\n${colors.red}Invalid file path: path traversal not allowed${colors.reset}\n`);
    return;
  }

  if (!fs.existsSync(fullPath)) {
    log(`\n${colors.red}File not found: ${filePath}${colors.reset}\n`);
    return;
  }

  const stats = fs.statSync(fullPath);
  if (stats.isDirectory()) {
    log(`\n${colors.red}Cannot upload directories${colors.reset}\n`);
    return;
  }

  if (stats.size > MAX_UPLOAD_SIZE) {
    log(`\n${colors.red}File too large (max ${formatSize(MAX_UPLOAD_SIZE)})${colors.reset}\n`);
    return;
  }

  if (stats.size === 0) {
    log(`\n${colors.red}Cannot upload empty file${colors.reset}\n`);
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log(`\n${colors.yellow}Not connected to bridge${colors.reset}\n`);
    return;
  }

  const fileName = path.basename(fullPath);
  if (!fileName) {
    log(`\n${colors.red}Invalid file path${colors.reset}\n`);
    return;
  }

  const fileSize = stats.size;
  const mimeType = getMimeType(fileName);

  log(`\n${colors.dim}Uploading ${fileName} (${formatSize(fileSize)})...${colors.reset}`);

  try {
    // Request upload URL from bridge
    ws.send(JSON.stringify({
      type: 'get_upload_url',
      name: fileName,
      mimeType: mimeType,
      size: fileSize,
    }));

    const response = await waitForMessage(ws, 'upload_url', 'upload');
    const uploadUrl = response.url as string;
    const fileId = response.fileId as string;

    // Upload to S3
    const fileData = fs.readFileSync(fullPath);
    const parsedUrl = new URL(uploadUrl);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize,
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: HTTP ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.write(fileData);
      req.end();
    });

    // Confirm upload
    ws.send(JSON.stringify({
      type: 'confirm_upload',
      fileId: fileId,
    }));

    log(`${colors.green}Uploaded ${fileName}${colors.reset}`);
    log(`${colors.dim}File ID: ${fileId}${colors.reset}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`${colors.red}Upload failed: ${message}${colors.reset}\n`);
  }
}

/**
 * /download <file-id> [-o path] - Download file
 */
export async function slashCmdDownload(
  fileId: string | undefined,
  args: string[],
  ws: WebSocket | null,
  log: (msg: string) => void
): Promise<void> {
  if (!fileId) {
    log(`\n${colors.yellow}Usage: /download <file-id> [-o path]${colors.reset}\n`);
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log(`\n${colors.yellow}Not connected to bridge${colors.reset}\n`);
    return;
  }

  // Parse output path from args
  let outputPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' && args[i + 1]) {
      outputPath = args[i + 1];
      break;
    }
  }

  log(`\n${colors.dim}Downloading...${colors.reset}`);

  try {
    // Request download URL from bridge
    ws.send(JSON.stringify({
      type: 'get_download_url',
      fileId: fileId,
    }));

    const response = await waitForMessage(ws, 'download_url', 'download');
    const downloadUrl = response.url as string;
    const fileName = (response.name as string) || `download_${fileId}`;

    if (!downloadUrl) {
      log(`${colors.red}No download URL received${colors.reset}\n`);
      return;
    }

    // Download from URL
    const parsedUrl = new URL(downloadUrl);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const fileData = await new Promise<Buffer>((resolve, reject) => {
      httpModule.get({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        } else {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
      }).on('error', reject);
    });

    // Sanitize filename from server to prevent path traversal
    const safeFileName = sanitizeFileName(fileName);

    // Determine output path - sanitize user-provided path too
    let outPath: string;
    if (outputPath) {
      const sanitizedOutput = sanitizePath(outputPath);
      if (!sanitizedOutput) {
        log(`${colors.red}Invalid output path: path traversal not allowed${colors.reset}\n`);
        return;
      }
      outPath = sanitizedOutput;
    } else {
      outPath = path.join(process.cwd(), safeFileName);
    }

    fs.writeFileSync(outPath, fileData);

    log(`${colors.green}Downloaded ${fileName}${colors.reset}`);
    log(`${colors.dim}Saved to: ${outPath}${colors.reset}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`${colors.red}Download failed: ${message}${colors.reset}\n`);
  }
}

/**
 * /files - List uploaded files
 */
export async function slashCmdFiles(
  ws: WebSocket | null,
  log: (msg: string) => void
): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log(`\n${colors.yellow}Not connected to bridge${colors.reset}\n`);
    return;
  }

  log(`\n${colors.dim}Fetching files...${colors.reset}`);

  try {
    ws.send(JSON.stringify({
      type: 'list_folder_contents',
    }));

    const response = await waitForMessage(ws, 'folder_contents', 'list', 10000);
    const files = (response.contents || response.files || []) as Array<{
      id?: string;
      name?: string;
      size?: number;
      createdAt?: string;
    }>;

    if (files.length === 0) {
      log(`${colors.dim}No files uploaded${colors.reset}\n`);
      return;
    }

    log('');
    log(`${'ID'.padEnd(14)} ${'NAME'.padEnd(30)} ${'SIZE'.padEnd(10)} UPLOADED`);
    log(`${'-'.repeat(14)} ${'-'.repeat(30)} ${'-'.repeat(10)} ${'-'.repeat(15)}`);

    for (const file of files) {
      const id = (file.id || '').slice(0, 12);
      const name = (file.name || '').slice(0, 28);
      const size = formatSize(file.size || 0);
      const date = file.createdAt ? new Date(file.createdAt).toLocaleDateString() : '';
      log(`${id.padEnd(14)} ${name.padEnd(30)} ${size.padEnd(10)} ${date}`);
    }
    log('');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`${colors.red}Failed to list files: ${message}${colors.reset}\n`);
  }
}
