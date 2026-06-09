import { CLIENT_DOMAIN_MAP_PATH } from '../config.js'
import { readJsonFile, saveJsonFile } from '../utils.js'

// Table apprise « domaine email → nom de client Jira ».
// Source de vérité rapide et exacte une fois apprise (ex. "edf.com" → "EDF DSIT").
// Alimentée par validation utilisateur à la création du ticket.

// Fournisseurs génériques / personnels : n'identifient AUCUN client → jamais utilisés ni appris.
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr',
  'live.com', 'live.fr', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'free.fr',
  'orange.fr', 'wanadoo.fr', 'sfr.fr', 'laposte.net', 'gmx.com', 'gmx.fr', 'proton.me',
  'protonmail.com', 'aol.com', 'msn.com', 'neuf.fr', 'bbox.fr', 'numericable.fr',
])

// Domaines partagés par plusieurs entités : on NE fige PAS de mapping, l'entité exacte
// doit être déterminée par la signature (analyse Codex à chaque fois). Extensible.
const AMBIGUOUS_CLIENT_DOMAINS = new Set([
  'safrangroup.com', 'safran-group.com', 'safran.com', 'safran.fr',
])

type ClientDomainMap = Record<string, string>

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^\.+|\.+$/g, '')
}

export function isGenericDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(normalizeDomain(domain))
}

export function isAmbiguousDomain(domain: string): boolean {
  return AMBIGUOUS_CLIENT_DOMAINS.has(normalizeDomain(domain))
}

// Extrait les domaines "client" exploitables d'une liste d'expéditeurs ("Nom <a@b.com>").
// Ignore iObeya et les fournisseurs génériques.
export function extractClientDomains(senders: string[]): string[] {
  const out = new Set<string>()
  for (const sender of senders) {
    const matches = (sender || '').toLowerCase().matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/g)
    for (const m of matches) {
      const domain = normalizeDomain(m[1] || '')
      if (!domain) continue
      if (domain.includes('iobeya')) continue
      if (isGenericDomain(domain)) continue
      out.add(domain)
    }
  }
  return Array.from(out)
}

export async function readClientDomainMap(): Promise<ClientDomainMap> {
  try {
    return await readJsonFile<ClientDomainMap>(CLIENT_DOMAIN_MAP_PATH)
  } catch {
    return {}
  }
}

// Cherche un client par domaine (hors domaines ambigus, laissés à l'analyse signature).
export async function lookupClientByDomain(domains: string[]): Promise<{ domain: string; client: string } | null> {
  const map = await readClientDomainMap()
  for (const domain of domains) {
    const key = normalizeDomain(domain)
    if (isAmbiguousDomain(key)) continue
    const client = map[key]
    if (client && client.trim()) return { domain: key, client: client.trim() }
  }
  return null
}

// Apprend domaine → client (validation utilisateur). Ignore générique + ambigu.
export async function learnClientDomains(domains: string[], client: string): Promise<void> {
  const clean = client.trim()
  if (!clean || clean.toLowerCase() === 'tbd') return
  const learnable = domains
    .map(normalizeDomain)
    .filter((d) => d && !isGenericDomain(d) && !isAmbiguousDomain(d) && !d.includes('iobeya'))
  if (learnable.length === 0) return

  const map = await readClientDomainMap()
  let changed = false
  for (const domain of learnable) {
    if (map[domain] !== clean) {
      map[domain] = clean
      changed = true
    }
  }
  if (changed) await saveJsonFile(CLIENT_DOMAIN_MAP_PATH, map)
}
