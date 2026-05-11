import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CommandResult } from './types.js'

export function runCommand(command: string, args: readonly string[], cwd: string, timeoutMs = 0): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return
            timedOut = true
            stderr += `\nCommand timeout after ${timeoutMs}ms`
            child.kill('SIGTERM')
            setTimeout(() => { if (!settled) child.kill('SIGKILL') }, 1500)
          }, timeoutMs)
        : null

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })

    child.on('error', (error) => {
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr })
    })
  })
}

export function runBinaryCommand(command: string, args: readonly string[], cwd?: string): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdoutChunks), stderr })
    })
  })
}

type JsonRes = { setHeader: (n: string, v: string) => void; end: (body: string) => void; statusCode: number }

export function sendJson(res: JsonRes, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export function readJsonBody(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf-8') })
    req.on('end', () => {
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw) as Record<string, unknown>) }
      catch { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

export async function saveJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return raw
  return raw.slice(start, end + 1)
}

export function parseCodexJson<T>(raw: string): T | null {
  try {
    const jsonChunk = extractJsonObject(raw)
    return JSON.parse(jsonChunk) as T
  } catch {
    return null
  }
}

/**
 * Extrait un message d'erreur lisible depuis la sortie brute de codex exec.
 * Supprime le header de session (workdir, model, etc.) et parse les erreurs JSON.
 */
export function sanitizeCodexError(raw: string): string {
  if (!raw?.trim()) return 'Erreur inconnue.'

  // Extraire les lignes ERROR: {...} (erreurs JSON de l'API)
  const errorLines = raw.split('\n').filter(l => l.startsWith('ERROR:'))
  for (const line of errorLines) {
    try {
      const json = JSON.parse(line.replace(/^ERROR:\s*/, '')) as {
        error?: { message?: string }
        message?: string
      }
      const msg = json.error?.message ?? json.message
      if (msg) return msg
    } catch { /* continue */ }
  }

  // Supprimer le header codex (tout ce qui précède la seconde ligne "--------")
  const separators = [...raw.matchAll(/^--------/gm)]
  const cleaned = separators.length >= 2
    ? raw.slice(separators[1].index! + 8).trim()
    : raw

  // Supprimer les timestamps ISO et les lignes de log internes
  const lines = cleaned
    .split('\n')
    .map(l => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\w+\s+[\w:]+:\s*/g, '').trim())
    .filter(l => l.length > 0 && !l.startsWith('workdir:') && !l.startsWith('model:')
      && !l.startsWith('provider:') && !l.startsWith('approval:') && !l.startsWith('sandbox:')
      && !l.startsWith('session id:') && !l.startsWith('reasoning') && !l.startsWith('user ')
      && !l.includes('research preview') && !l.startsWith('Reading additional'))

  const result = lines.join(' ').trim()
  return result.length > 0 ? result.slice(0, 300) : 'Erreur inconnue.'
}

export function buildCodexPrompt(userPrompt: string, useSubagents: boolean): string {
  if (!useSubagents) return userPrompt
  return [
    'Mode subagents activé.',
    'Tu dois utiliser de vrais subagents pour exécuter cette demande (spawn_agent / délégation réelle).',
    'Travaille avec un découpage clair, délègue les tâches non bloquantes, puis consolide le résultat final.',
    '',
    `Demande utilisateur: ${userPrompt}`,
  ].join('\n')
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export function stripReplyPrefixes(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return ''
  return trimmed.replace(/^(?:(?:re|tr|fw|fwd)\s*:\s*)+/i, '').trim()
}

export function getThreadIdFromAnalyzeInput(input: { id?: string; conversationId?: string } | undefined): string | null {
  const threadId = input?.conversationId?.trim() || input?.id?.trim()
  return threadId || null
}
