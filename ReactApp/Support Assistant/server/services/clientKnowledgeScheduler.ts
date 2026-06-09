import { getClientKnowledgeAgeMs, refreshClientKnowledge } from './clientKnowledge.js'

// Routine hebdomadaire « dimanche soir à minuit » = bascule dimanche→lundi à 00:00
// local (la base est ainsi fraîche pour le lundi matin). Ajustable via ces 2 constantes.
const TARGET_DAY = 1 // 0=dimanche … 1=lundi
const TARGET_HOUR = 0

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 20_000 // laisser le serveur démarrer avant le rattrapage
const STALE_THRESHOLD_MS = ONE_WEEK_MS // rattrapage si la base date de plus d'une semaine

let started = false
let weeklyTimer: NodeJS.Timeout | null = null
let refreshing = false

function msUntilNextRun(from = new Date()): number {
  const next = new Date(from)
  next.setHours(TARGET_HOUR, 0, 0, 0)
  let add = (TARGET_DAY - from.getDay() + 7) % 7
  if (add === 0 && next.getTime() <= from.getTime()) add = 7
  next.setDate(from.getDate() + add)
  return next.getTime() - from.getTime()
}

async function runRefresh(reason: string): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    console.log(`[client-knowledge] Rafraîchissement (${reason})…`)
    await refreshClientKnowledge()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[client-knowledge] Rafraîchissement (${reason}) échoué : ${message}`)
  } finally {
    refreshing = false
  }
}

function scheduleWeekly(): void {
  if (weeklyTimer) clearTimeout(weeklyTimer)
  const delay = msUntilNextRun()
  weeklyTimer = setTimeout(() => {
    void runRefresh('routine hebdomadaire').finally(scheduleWeekly)
  }, delay)
  if (typeof weeklyTimer.unref === 'function') weeklyTimer.unref()
  const next = new Date(Date.now() + delay)
  console.log(`[client-knowledge] Prochaine routine planifiée : ${next.toISOString()}`)
}

/**
 * Démarre la routine de mise à jour de la base de connaissances clients.
 * Appelé UNE fois au démarrage du serveur (hook Vite `configureServer`, non rejoué au HMR).
 * - Rattrapage au boot si la base date de plus d'une semaine (app éteinte le dimanche).
 * - Puis exécution hebdomadaire (lundi 00:00 local).
 */
export function startClientKnowledgeScheduler(): void {
  if (started) return
  started = true

  const startupTimer = setTimeout(() => {
    void (async () => {
      try {
        const age = await getClientKnowledgeAgeMs()
        if (age > STALE_THRESHOLD_MS) {
          const label = age === Number.POSITIVE_INFINITY ? 'base jamais initialisée' : 'base de plus de 7 jours'
          await runRefresh(`rattrapage au démarrage — ${label}`)
        }
      } catch {
        // Ne jamais bloquer le démarrage du serveur sur la base de connaissances.
      }
    })()
  }, STARTUP_DELAY_MS)
  if (typeof startupTimer.unref === 'function') startupTimer.unref()

  scheduleWeekly()
}
