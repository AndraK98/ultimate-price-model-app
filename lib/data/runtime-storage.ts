import path from "node:path";

function resolveStorageRoot() {
  const configuredRoot = process.env.CAPUCINNE_STORAGE_DIR?.trim();

  if (configuredRoot) {
    return configuredRoot;
  }

  if (process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "capucinne-google-sheet-app");
  }

  return path.join(process.cwd(), "storage");
}

const storageRoot = resolveStorageRoot();

export function resolveRuntimeStoragePath(filename: string) {
  return path.join(storageRoot, filename);
}

export function getRuntimeStorageRoot() {
  return storageRoot;
}
