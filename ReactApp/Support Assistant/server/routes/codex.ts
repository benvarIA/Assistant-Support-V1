import path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { APP_DIR } from '../config.js'
import { buildCodexPrompt, readJsonBody, runCommand, sendJson } from '../utils.js'

export async function handleCodexRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/codex/exec') {
    const body = await readJsonBody(req)
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const useSubagents = body.useSubagents === true

    if (!prompt) {
      sendJson(res, 400, { error: 'Missing prompt' })
      return true
    }

    const finalPrompt = buildCodexPrompt(prompt, useSubagents)

    const outputFile = path.join('/tmp', `codex-last-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`)
    const result = await runCommand(
      'codex',
      ['exec', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, finalPrompt],
      APP_DIR,
      120000,
    )

    let lastMessage = ''
    try {
      lastMessage = (await readFile(outputFile, 'utf-8')).trimEnd()
    } catch {
      lastMessage = ''
    } finally {
      void unlink(outputFile).catch(() => undefined)
    }

    sendJson(res, result.code === 0 ? 200 : 500, {
      ...result,
      stdout: lastMessage || result.stdout,
      stderr: result.code === 0 ? '' : result.stderr,
    })
    return true
  }

  return false
}
