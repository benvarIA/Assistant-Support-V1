import { readFile } from 'node:fs/promises'
import { CLIENT_TECH_INFO_PATH } from '../config.js'

export type ClientSetup =
  | 'Onsite'
  | 'Online Dedicated'
  | 'Mutualised TEAMPLUS'
  | 'Mutualised TEAM'
  | 'Mutualised PARTNERS'
  | 'Online NextGen - Enterprise'
  | 'Online NextGen - Team'
  | 'Online NextGen - Trial'

export type ClientLanguage = 'French' | 'English'

export type ClientTechInfo = {
  name: string
  setup: ClientSetup | string
  language: ClientLanguage | string
  status: string
}

// Maps Excel "Set up" values → Jira customfield_12413 allowed values
export const SETUP_TO_JIRA_DEPLOYMENT: Record<string, string> = {
  'Onsite': 'Onsite',
  'Online Dedicated': 'Online',
  'Mutualised TEAMPLUS': 'Mutualisée (Team+, Team, Partners)',
  'Mutualised TEAM': 'Mutualisée (Team+, Team, Partners)',
  'Mutualised PARTNERS': 'Mutualisée (Team+, Team, Partners)',
  'Online NextGen - Enterprise': 'Online',
  'Online NextGen - Team': 'Mutualisée (Team+, Team, Partners)',
  'Online NextGen - Trial': 'Online',
}

// Maps Excel "Set up" values → Kiba clientType
export const SETUP_TO_KIBA_CLIENT_TYPE: Record<string, 'ON-SITE' | 'ONLINE dédié' | 'Mutualisée'> = {
  'Onsite': 'ON-SITE',
  'Online Dedicated': 'ONLINE dédié',
  'Mutualised TEAMPLUS': 'Mutualisée',
  'Mutualised TEAM': 'Mutualisée',
  'Mutualised PARTNERS': 'Mutualisée',
  'Online NextGen - Enterprise': 'ONLINE dédié',
  'Online NextGen - Team': 'Mutualisée',
  'Online NextGen - Trial': 'ONLINE dédié',
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let cache: Map<string, ClientTechInfo> | null = null

export function invalidateClientTechInfoCache(): void {
  cache = null
}

async function loadClientTechInfoMap(): Promise<Map<string, ClientTechInfo>> {
  if (cache) return cache
  const map = new Map<string, ClientTechInfo>()
  try {
    const raw = await readFile(CLIENT_TECH_INFO_PATH, 'utf-8')
    const entries = JSON.parse(raw) as ClientTechInfo[]
    for (const entry of entries) {
      if (entry.name) {
        map.set(normalizeKey(entry.name), entry)
      }
    }
  } catch {
    // file optional
  }
  cache = map
  return map
}

export async function lookupClientTechInfo(clientName: string): Promise<ClientTechInfo | null> {
  if (!clientName) return null
  const map = await loadClientTechInfoMap()
  if (map.size === 0) return null

  const key = normalizeKey(clientName)
  if (!key) return null

  // Exact match first
  const exact = map.get(key)
  if (exact) return exact

  // Substring match: key contains stored key or vice versa
  for (const [storedKey, info] of map) {
    if (storedKey.length >= 4 && (key.includes(storedKey) || storedKey.includes(key))) {
      return info
    }
  }

  return null
}

export function setupToJiraDeployment(setup: string): string | null {
  return SETUP_TO_JIRA_DEPLOYMENT[setup] ?? null
}

export function setupToKibaClientType(setup: string): 'ON-SITE' | 'ONLINE dédié' | 'Mutualisée' | null {
  return SETUP_TO_KIBA_CLIENT_TYPE[setup] ?? null
}

export function languageToKiba(language: string): 'FR' | 'EN' | null {
  if (language === 'French') return 'FR'
  if (language === 'English') return 'EN'
  return null
}
