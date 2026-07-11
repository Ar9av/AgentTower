const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '')

/** Prefix an app-relative browser URL for sub-path deployments such as /logs. */
export function appPath(path: string): string {
  if (!path.startsWith('/') || !BASE_PATH || path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    return path
  }
  return `${BASE_PATH}${path}`
}
