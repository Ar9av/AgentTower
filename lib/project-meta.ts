import fs from 'fs'
import path from 'path'
import os from 'os'

const META_PATH = path.join(os.homedir(), '.claude', 'agenttower-project-meta.json')

export interface ProjectMeta {
  displayName?: string
  githubUrl?: string
  createdAt?: string
}

export interface ProjectMetaStore {
  projects: Record<string, ProjectMeta>  // keyed by absolute project path
}

const EMPTY: ProjectMetaStore = { projects: {} }

export function loadProjectMeta(): ProjectMetaStore {
  try {
    const raw = fs.readFileSync(META_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProjectMetaStore>
    return { projects: parsed.projects ?? {} }
  } catch {
    return { ...EMPTY, projects: {} }
  }
}

export function saveProjectMeta(store: ProjectMetaStore): void {
  fs.mkdirSync(path.dirname(META_PATH), { recursive: true })
  fs.writeFileSync(META_PATH, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function getProjectMeta(projectPath: string): ProjectMeta | null {
  const store = loadProjectMeta()
  return store.projects[projectPath] ?? null
}

export function upsertProjectMeta(projectPath: string, patch: ProjectMeta): ProjectMeta {
  const store = loadProjectMeta()
  const prev = store.projects[projectPath] ?? {}
  const next = { ...prev, ...patch }
  store.projects[projectPath] = next
  saveProjectMeta(store)
  return next
}

export function getWorkspaceRoot(): string {
  const explicit = process.env.WORKSPACE_DIR
  if (explicit) return explicit
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude', 'agenttower-integrations.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    const dir = parsed?.telegram?.projectsDir
    if (typeof dir === 'string' && dir) return dir
  } catch {}
  return path.join(os.homedir(), 'projects')
}
