import type { IncomingMessage, ServerResponse } from 'node:http'
import { ASSISTANT_PRO_DIR, CONNECTOR_COMMANDS, microsoftLoginState, startMicrosoftLoginProcess } from '../config.js'
import { runCommand, sendJson } from '../utils.js'

export async function handleConnectRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method === 'POST' && req.url === '/api/connect/jira') {
    const { command, args } = CONNECTOR_COMMANDS.jira
    const result = await runCommand(command, args, ASSISTANT_PRO_DIR)
    sendJson(res, result.code === 0 ? 200 : 500, result)
    return true
  }

  if (req.method === 'POST' && req.url === '/api/connect/microsoft') {
    const state = startMicrosoftLoginProcess()
    await new Promise((resolve) => setTimeout(resolve, 350))
    sendJson(res, 200, {
      code: state.code ?? 0,
      stdout:
        state.stdout.trim() ||
        'Connexion Microsoft lancée. Ouvre https://login.microsoft.com/device et saisis le code affiché.',
      stderr: state.stderr,
      running: state.isRunning,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
    })
    return true
  }

  if (req.method === 'GET' && req.url === '/api/connect/microsoft/status') {
    if (!microsoftLoginState) {
      sendJson(res, 404, {
        code: 1,
        stdout: '',
        stderr: '',
        error: "Aucune connexion Microsoft en cours. Clique d'abord sur 'Connecter Microsoft (skill)'.",
        running: false,
      })
      return true
    }

    sendJson(res, 200, {
      code: microsoftLoginState.code ?? 0,
      stdout: microsoftLoginState.stdout,
      stderr: microsoftLoginState.stderr,
      running: microsoftLoginState.isRunning,
      startedAt: microsoftLoginState.startedAt,
      finishedAt: microsoftLoginState.finishedAt,
    })
    return true
  }

  return false
}
