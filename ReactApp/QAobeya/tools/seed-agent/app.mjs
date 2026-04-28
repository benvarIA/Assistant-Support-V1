#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadConfig(envPath) {
  const merged = { ...parseEnvFile(envPath), ...process.env };
  const baseUrl = merged.IOBEYA_BASE_URL || `http://localhost:${merged.HTTP_PORT_HOST || '8080'}`;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    loginPath: merged.IOBEYA_LOGIN_PATH || '/j_spring_security_check',
    username: merged.IOBEYA_ADMIN_USERNAME || '',
    password: merged.IOBEYA_ADMIN_PASSWORD || '',
    token: merged.IOBEYA_PAT_TOKEN || '',
    dryRun: String(merged.IOBEYA_SEED_DRY_RUN || '').toLowerCase() === 'true',
    maxBoardsDefault: Number(merged.IOBEYA_ROOM_MAX_BOARDS || 40),
    maxUsersDefault: Number(merged.IOBEYA_ROOM_MAX_USERS || 200),
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function format(obj) {
  return JSON.stringify(obj, null, 2);
}

function isSuccessPayload(payload) {
  if (!payload) return false;
  if (typeof payload === 'string') {
    const t = payload.toLowerCase();
    return t.includes('success') || t.includes('already exists') || t.includes('already used');
  }
  const result = String(payload.result || payload.code || '').toLowerCase();
  if (result === 'success' || result === 'ok') return true;
  if (result === 'error' && Array.isArray(payload.messages)) {
    const msg = payload.messages.join(' ').toLowerCase();
    if (msg.includes('already exists') || msg.includes('already used') || msg.includes('already')) return true;
  }
  return false;
}

function extractCollection(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function hasValidId(entity) {
  return Boolean(String(entity?.id || '').trim());
}

class IobeyaSeedAgent {
  constructor(config) {
    this.config = config;
    this.cookies = [];
  }

  buildUrl(pathOrUrl, query) {
    const url = pathOrUrl.startsWith('http')
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl.replace(/^\//, ''), `${this.config.baseUrl}/`);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, String(item));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url;
  }

  authHeaders() {
    const headers = {};
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    if (this.cookies.length > 0) headers.Cookie = this.cookies.join('; ');
    return headers;
  }

  async login() {
    if (this.config.token || this.config.dryRun) return;
    if (!this.config.username || !this.config.password) {
      throw new Error('Authentification manquante: définir IOBEYA_ADMIN_USERNAME/IOBEYA_ADMIN_PASSWORD ou IOBEYA_PAT_TOKEN.');
    }
    const loginUrl = this.buildUrl(this.config.loginPath);
    const body = new URLSearchParams({ username: this.config.username, password: this.config.password });
    const response = await fetch(loginUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const setCookie = response.headers.getSetCookie?.() || [];
    this.cookies = setCookie.map((c) => c.split(';')[0]).filter(Boolean);
    if (response.status >= 400) {
      throw new Error(`Echec login ${response.status}: ${(await response.text()).slice(0, 600)}`);
    }
  }

  async request({ method, path: endpointPath, query, body, headers = {}, form }) {
    if (
      !this.config.dryRun &&
      !this.config.token &&
      this.cookies.length === 0 &&
      endpointPath !== this.config.loginPath
    ) {
      await this.login();
    }

    const url = this.buildUrl(endpointPath, query);
    if (this.config.dryRun) {
      return {
        ok: true,
        status: 200,
        url: String(url),
        body: { dryRun: true, method, endpointPath, query, body, form },
      };
    }

    const requestHeaders = {
      Accept: 'application/json, text/plain, */*',
      ...this.authHeaders(),
      ...headers,
    };
    const options = { method, headers: requestHeaders, redirect: 'follow' };

    if (form) {
      const formBody = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) {
        if (v === undefined || v === null) continue;
        formBody.append(k, String(v));
      }
      options.body = formBody;
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, options);
    const text = await response.text();
    const parsed = parseMaybeJson(text);
    return {
      ok: response.ok,
      status: response.status,
      url: String(url),
      body: parsed,
      text,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  gluePath(subPath) {
    const cleaned = subPath.startsWith('/') ? subPath : `/${subPath}`;
    return `/s/j/gluecode${cleaned}`;
  }

  async health() {
    await this.login();
    return this.request({ method: 'GET', path: this.gluePath('/domains') });
  }

  async listDomains() {
    const res = await this.request({ method: 'GET', path: this.gluePath('/domains') });
    if (!res.ok) return [];
    return extractCollection(res.body);
  }

  async listRooms(domainId) {
    const res = await this.request({ method: 'GET', path: this.gluePath(`/rooms/domain/${encodeURIComponent(domainId)}`) });
    if (!res.ok) return [];
    return extractCollection(res.body);
  }

  async listBoards(roomId) {
    const res = await this.request({ method: 'GET', path: this.gluePath(`/rooms/${encodeURIComponent(roomId)}/boards`) });
    if (!res.ok) return [];
    return extractCollection(res.body);
  }

  async listBoardsDetailed(roomId) {
    const res = await this.request({
      method: 'GET',
      path: '/s/j/boards',
      query: { container: roomId },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) return [];
    return extractCollection(res.body);
  }

  normalizeEmail(email, login) {
    const candidate = String(email || '').trim();
    if (!candidate) return `${login}@example.com`;
    if (candidate.endsWith('.local')) return `${candidate.slice(0, -6)}.com`;
    return candidate;
  }

  async createUser(user) {
    const login = String(user.username || user.login || '').trim();
    if (!login) {
      return { ok: false, status: 400, body: { result: 'error', messages: ['username/login manquant'] } };
    }
    const firstName = user.firstname || user.firstName || 'Test';
    const lastName = user.lastname || user.lastName || 'User';
    const email = this.normalizeEmail(user.email, login);

    const res = await this.request({
      method: 'POST',
      path: '/admin/user/save-user.action',
      form: {
        login,
        'user.firstName': firstName,
        'user.lastName': lastName,
        'user.email': email,
        'user.enabled': user.enabled === false ? 'false' : 'true',
        'user.language': user.language || 'fr',
        'user.country': user.country || 'FR',
        'user.site': user.site || '',
        'user.service': user.service || '',
      },
    });

    return {
      ...res,
      ok: isSuccessPayload(res.body),
      normalizedInput: { login, firstName, lastName, email },
    };
  }

  async pollAsyncResult(retryUrl) {
    for (let i = 0; i < 30; i += 1) {
      const probe = await this.request({ method: 'GET', path: retryUrl });
      if (!probe.ok && probe.status === 404) {
        // endpoint can disappear after completion; caller will verify by listing rooms
        return probe;
      }
      const code = String(probe.body?.code || '').toUpperCase();
      const result = String(probe.body?.result || '').toLowerCase();
      if (code !== 'RETRY' || result === 'success') {
        return probe;
      }
      await sleep(300);
    }
    return { ok: false, status: 504, body: { result: 'error', messages: ['Timeout async'] } };
  }

  async createRoom(room, domainId) {
    const name = String(room.name || '').trim();
    if (!name) {
      return { ok: false, status: 400, body: { result: 'error', messages: ['room.name manquant'] } };
    }

    const maxBoards = Number(room.maximumBoards || this.config.maxBoardsDefault || 40);
    const maxUsers = Number(room.maximumUsers || this.config.maxUsersDefault || 200);
    const res = await this.request({
      method: 'POST',
      path: '/admin/room/save-room.action',
      form: {
        'room.id': '',
        'room.name': name,
        'room.domainId': domainId,
        'room.maximumBoards': Number.isFinite(maxBoards) && maxBoards > 0 ? maxBoards : 40,
        'room.maximumUsers': Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : 200,
        'room.administrator': room.administrator || this.config.username || 'admin',
        'room.roomType': room.roomType || 'StandardRoom',
        'room.description': room.description || '',
        modelId: room.modelId || '',
      },
    });

    if (res.body?.retryUrl) {
      const follow = await this.pollAsyncResult(String(res.body.retryUrl).replaceAll('\\/', '/'));
      return {
        ...follow,
        initial: res,
        ok: isSuccessPayload(follow.body) || follow.status === 404,
      };
    }

    return { ...res, ok: isSuccessPayload(res.body) };
  }

  async cloneBoardFromTemplate(sourceBoard, roomId, newName, xOffset = 0, yOffset = 0) {
    const clone = { ...sourceBoard };
    clone.id = randomUUID();
    clone.name = newName;
    clone.container = {
      '@class': 'com.iobeya.dto.EntityReferenceDTO',
      id: roomId,
      type: 'com.iobeya.dto.RoomDTO',
    };
    if (clone.elementContainer) {
      clone.elementContainer = {
        ...clone.elementContainer,
        id: randomUUID(),
      };
    }
    if (clone.boardDock) {
      clone.boardDock = {
        ...clone.boardDock,
        id: randomUUID(),
      };
    }
    clone.x = (Number(sourceBoard.x) || 0) + xOffset;
    clone.y = (Number(sourceBoard.y) || 0) + yOffset;

    const payload = {
      '@class': 'com.iobeya.dto.CloneParamDTO',
      ids: [sourceBoard.id],
      dtos: [clone],
    };

    const res = await this.request({
      method: 'PUT',
      path: '/s/j/boards/clone',
      body: payload,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    return { ...res, ok: res.ok };
  }

  async createBoardNotes(elementContainerId, notes) {
    const dtos = notes.map((n, idx) => ({
      '@class': 'com.iobeya.dto.BoardNoteDTO',
      container: {
        '@class': 'com.iobeya.dto.EntityReferenceDTO',
        id: elementContainerId,
        type: 'com.iobeya.dto.ElementContainerDTO',
      },
      contentLabel: n.contentLabel,
      name: n.name,
      setName: 'Notes',
      color: n.color ?? 13158655,
      width: n.width ?? 150,
      height: n.height ?? 105,
      x: n.x ?? (120 + (idx * 170)),
      y: n.y ?? (100 + ((idx % 2) * 140)),
      zOrder: n.zOrder ?? (8 + idx),
      isLocked: false,
      isAnchored: false,
    }));

    const res = await this.request({
      method: 'POST',
      path: '/s/j/elements',
      body: dtos,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    return { ...res, ok: res.status === 201 || res.ok };
  }

  async customCall(custom) {
    const fullPath = String(custom.path || '/');
    return this.request({
      method: String(custom.method || 'GET').toUpperCase(),
      path: fullPath,
      query: custom.query,
      body: custom.body,
      headers: custom.headers || {},
    });
  }
}

function loadJsonFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  return { absolutePath: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
}

async function runScenario(agent, scenario) {
  const out = {
    ok: true,
    domain: null,
    users: [],
    rooms: [],
    customRequests: [],
    logs: [],
  };

  const health = await agent.health();
  out.logs.push({ step: 'health', status: health.status, ok: health.ok });
  if (!health.ok) {
    return { ...out, ok: false, error: `Health check KO (${health.status})`, health };
  }

  const domains = await agent.listDomains();
  const fallbackDomainId = scenario.defaults?.domainId || domains[0]?.id || null;
  out.domain = fallbackDomainId;
  if (!fallbackDomainId) {
    return { ...out, ok: false, error: 'Aucun domainId disponible' };
  }

  for (const user of scenario.users || []) {
    const res = await agent.createUser(user);
    out.users.push({ input: user, response: res });
    out.logs.push({ step: 'user', login: user.username || user.login, ok: res.ok, status: res.status });
    if (!res.ok) out.ok = false;
    await sleep(80);
  }

  for (const room of scenario.rooms || []) {
    const create = await agent.createRoom(room, fallbackDomainId);
    const rooms = await agent.listRooms(fallbackDomainId);
    const found = rooms.find((r) => String(r.name || '').trim() === String(room.name || '').trim()) || null;
    let boards = [];
    let detailedBoards = [];
    const createdBoards = [];
    const createdNotes = [];

    if (found?.id) {
      boards = await agent.listBoards(found.id);
      detailedBoards = await agent.listBoardsDetailed(found.id);
    }

    if (found?.id && Array.isArray(room.boards) && room.boards.length > 0 && detailedBoards.length > 0) {
      const sourceBoard = detailedBoards.find((b) => b.name === 'Welcome board!' && hasValidId(b))
        || detailedBoards.find((b) => hasValidId(b))
        || null;
      if (!sourceBoard) {
        out.ok = false;
        out.logs.push({ step: 'room', room: room.name, ok: false, status: 500, error: 'No valid source board id' });
      }
      const existingNames = new Set(detailedBoards.map((b) => String(b.name || '')));

      for (let i = 0; sourceBoard && i < room.boards.length; i += 1) {
        const boardInput = room.boards[i];
        const boardName = String(boardInput.name || '').trim();
        if (!boardName || existingNames.has(boardName)) {
          continue;
        }

        const xOffset = (Number(boardInput.x) || 0) * 1200 + (i * 80);
        const yOffset = (Number(boardInput.y) || 0) * 700 + (i * 60);
        const cloneRes = await agent.cloneBoardFromTemplate(sourceBoard, found.id, boardName, xOffset, yOffset);
        createdBoards.push({ name: boardName, clone: cloneRes });

        if (!cloneRes.ok) {
          out.ok = false;
          continue;
        }

        const refreshedBoards = await agent.listBoardsDetailed(found.id);
        const clonedBoard = refreshedBoards.find((b) => String(b.name || '').trim() === boardName);
        if (!clonedBoard?.elementContainer?.id) {
          out.ok = false;
          continue;
        }

        const notesRes = await agent.createBoardNotes(clonedBoard.elementContainer.id, [
          { name: 'Action #1', contentLabel: `${boardName} - point cle #1`, color: 16576050, x: 120, y: 100 },
          { name: 'Risque', contentLabel: `${boardName} - risque principal`, color: 16767673, x: 320, y: 230 },
          { name: 'Decision', contentLabel: `${boardName} - decision du jour`, color: 13158655, x: 520, y: 100 },
        ]);
        createdNotes.push({ board: boardName, response: notesRes });
        if (!notesRes.ok) {
          out.ok = false;
        }

        existingNames.add(boardName);
        await sleep(80);
      }

      boards = await agent.listBoards(found.id);
      detailedBoards = await agent.listBoardsDetailed(found.id);
    }

    const item = {
      input: room,
      create,
      foundRoomId: found?.id || null,
      boardCount: boards.length,
      boardNames: boards.map((b) => b.name).slice(0, 10),
      createdBoards: createdBoards.map((b) => ({ name: b.name, ok: b.clone.ok, status: b.clone.status })),
      createdNotes: createdNotes.map((n) => ({ board: n.board, ok: n.response.ok, status: n.response.status })),
      detailedBoardCount: detailedBoards.length,
    };
    out.rooms.push(item);
    out.logs.push({
      step: 'room',
      room: room.name,
      ok: create.ok && Boolean(found?.id),
      status: create.status,
      foundRoomId: found?.id || null,
      boardCount: boards.length,
    });

    if (!(create.ok && found?.id)) out.ok = false;
    await sleep(120);
  }

  for (const req of scenario.customRequests || []) {
    const res = await agent.customCall(req);
    out.customRequests.push({ input: req, response: res });
    out.logs.push({ step: 'custom', label: req.label || req.path, ok: res.ok, status: res.status });
    if (!res.ok) out.ok = false;
  }

  return out;
}

function printHelp() {
  console.log(`
Seed Agent iObeya (4.43 admin-compatible)

Usage:
  node tools/seed-agent/app.mjs health [--env .env] [--dry-run]
  node tools/seed-agent/app.mjs run --scenario scenarios/demo-instance.json [--env .env]
  node tools/seed-agent/app.mjs run-demo [--env .env]
  node tools/seed-agent/app.mjs custom --method POST --path /admin/user/save-user.action --body-file payload.json [--env .env]

Config (.env):
  IOBEYA_BASE_URL=http://localhost:8080
  IOBEYA_LOGIN_PATH=/j_spring_security_check
  IOBEYA_ADMIN_USERNAME=admin
  IOBEYA_ADMIN_PASSWORD=admin
  IOBEYA_PAT_TOKEN=
  IOBEYA_SEED_DRY_RUN=false
  IOBEYA_ROOM_MAX_BOARDS=40
  IOBEYA_ROOM_MAX_USERS=200
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const envPath = path.resolve(PROJECT_ROOT, args.env || '.env');
  const config = loadConfig(envPath);
  if (args['dry-run'] || args.dryRun) config.dryRun = true;

  const agent = new IobeyaSeedAgent(config);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'health') {
    const res = await agent.health();
    console.log(format({ ok: res.ok, status: res.status, url: res.url, body: res.body }));
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (cmd === 'run' || cmd === 'run-demo') {
    const scenarioPath = cmd === 'run-demo'
      ? path.resolve(PROJECT_ROOT, 'scenarios', 'demo-instance.json')
      : (args.scenario ? path.resolve(PROJECT_ROOT, args.scenario) : null);

    if (!scenarioPath) throw new Error('Option manquante: --scenario <path>');
    if (!fs.existsSync(scenarioPath)) throw new Error(`Scenario introuvable: ${scenarioPath}`);

    const { data } = loadJsonFile(scenarioPath);
    const run = await runScenario(agent, data);
    console.log(format(run));
    process.exitCode = run.ok ? 0 : 1;
    return;
  }

  if (cmd === 'custom') {
    if (!args.path) throw new Error('Option manquante: --path <endpoint>');
    const method = String(args.method || 'GET').toUpperCase();
    let body;
    if (args['body-file']) body = loadJsonFile(args['body-file']).data;
    else if (args.body) body = parseMaybeJson(String(args.body));

    const res = await agent.customCall({
      method,
      path: String(args.path),
      body,
    });
    console.log(format(res));
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('[seed-agent] error:', error.message || error);
  process.exitCode = 1;
});
