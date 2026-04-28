#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const WEB_DIR = path.join(__dirname, 'web');

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
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
    roomMaxBoards: Number(merged.IOBEYA_ROOM_MAX_BOARDS || 40),
    roomMaxUsers: Number(merged.IOBEYA_ROOM_MAX_USERS || 200),
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function hasValidId(entity) {
  return Boolean(String(entity?.id || '').trim());
}

function detectCreateState(body) {
  const txt = JSON.stringify(body || '').toLowerCase();
  if (txt.includes('successfully added') || txt.includes('"result":"success"')) return 'created';
  if (txt.includes('already exists') || txt.includes('already used')) return 'exists';
  return 'unknown';
}

function buildNotesTemplate(templateKey, boardName) {
  const name = String(boardName || 'Board').trim();
  const templates = {
    standup: [
      { name: 'Bloquant', contentLabel: `${name} - blocage du jour`, color: 16767673, x: 120, y: 100 },
      { name: 'Action', contentLabel: `${name} - action prioritaire`, color: 16576050, x: 320, y: 220 },
      { name: 'Decision', contentLabel: `${name} - decision`, color: 13158655, x: 520, y: 100 },
    ],
    risk: [
      { name: 'Risque #1', contentLabel: `${name} - risque majeur`, color: 16759414, x: 130, y: 100 },
      { name: 'Impact', contentLabel: `${name} - impact business`, color: 16772062, x: 340, y: 230 },
      { name: 'Mitigation', contentLabel: `${name} - plan de mitigation`, color: 15264495, x: 560, y: 100 },
    ],
    kaizen: [
      { name: 'Idee', contentLabel: `${name} - idee d'amelioration`, color: 16645629, x: 120, y: 100 },
      { name: 'Gain estime', contentLabel: `${name} - gain attendu`, color: 14737632, x: 330, y: 220 },
      { name: 'Owner', contentLabel: `${name} - responsable`, color: 13158655, x: 540, y: 100 },
    ],
  };
  return templates[templateKey] || templates.standup;
}

class IobeyaClient {
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
    if (this.config.token) return;
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
      const txt = await response.text();
      throw new Error(`Echec login ${response.status}: ${txt.slice(0, 400)}`);
    }
  }

  async request({ method, endpointPath, query, form, body, headers = {} }) {
    if (!this.config.token && this.cookies.length === 0 && endpointPath !== this.config.loginPath) {
      await this.login();
    }

    const url = this.buildUrl(endpointPath, query);
    const reqHeaders = {
      Accept: 'application/json, text/plain, */*',
      ...this.authHeaders(),
      ...headers,
    };

    const options = { method, headers: reqHeaders, redirect: 'follow' };

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
    return {
      ok: response.ok,
      status: response.status,
      url: String(url),
      body: safeJson(text, text),
      text,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  gluePath(subPath) {
    const cleaned = subPath.startsWith('/') ? subPath : `/${subPath}`;
    return `/s/j/gluecode${cleaned}`;
  }

  extractCollection(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    return [];
  }

  async health() {
    return this.request({ method: 'GET', endpointPath: this.gluePath('/domains') });
  }

  async listDomains() {
    const res = await this.request({ method: 'GET', endpointPath: this.gluePath('/domains') });
    return this.extractCollection(res.body);
  }

  async listRooms(domainId) {
    const res = await this.request({ method: 'GET', endpointPath: this.gluePath(`/rooms/domain/${encodeURIComponent(domainId)}`) });
    return this.extractCollection(res.body);
  }

  async listBoards(roomId) {
    const res = await this.request({ method: 'GET', endpointPath: '/s/j/boards', query: { container: roomId } });
    return this.extractCollection(res.body);
  }

  async createUser(input) {
    const login = String(input.username || input.login || '').trim();
    if (!login) throw new Error('username/login manquant');

    const res = await this.request({
      method: 'POST',
      endpointPath: '/admin/user/save-user.action',
      form: {
        login,
        'user.firstName': input.firstName || input.firstname || 'Test',
        'user.lastName': input.lastName || input.lastname || 'User',
        'user.email': input.email || `${login}@example.com`,
        'user.enabled': input.enabled === false ? 'false' : 'true',
        'user.language': input.language || 'fr',
        'user.country': input.country || 'FR',
        'user.site': input.site || '',
        'user.service': input.service || '',
      },
    });

    const msg = JSON.stringify(res.body || '').toLowerCase();
    const state = detectCreateState(res.body);
    return {
      ...res,
      ok: res.ok || state === 'exists',
      login,
      state,
    };
  }

  async pollAsyncResult(retryUrl) {
    for (let i = 0; i < 30; i += 1) {
      const probe = await this.request({ method: 'GET', endpointPath: retryUrl });
      if (!probe.ok && probe.status === 404) return probe;
      const code = String(probe.body?.code || '').toUpperCase();
      const result = String(probe.body?.result || '').toLowerCase();
      if (code !== 'RETRY' || result === 'success') return probe;
      await sleep(250);
    }
    return { ok: false, status: 504, body: { result: 'error', messages: ['Timeout async'] } };
  }

  async createRoom(input) {
    const name = String(input.name || '').trim();
    const domainId = String(input.domainId || '').trim();
    if (!name) throw new Error('room.name manquant');
    if (!domainId) throw new Error('domainId manquant');

    const maxBoards = Number(input.maximumBoards || this.config.roomMaxBoards || 40);
    const maxUsers = Number(input.maximumUsers || this.config.roomMaxUsers || 200);

    const res = await this.request({
      method: 'POST',
      endpointPath: '/admin/room/save-room.action',
      form: {
        'room.id': '',
        'room.name': name,
        'room.domainId': domainId,
        'room.maximumBoards': Number.isFinite(maxBoards) && maxBoards > 0 ? maxBoards : 40,
        'room.maximumUsers': Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : 200,
        'room.administrator': input.administrator || this.config.username || 'admin',
        'room.roomType': 'StandardRoom',
        'room.description': input.description || '',
        modelId: input.modelId || '',
      },
    });

    if (res.body?.retryUrl) {
      const follow = await this.pollAsyncResult(String(res.body.retryUrl).replaceAll('\\/', '/'));
      return { ...follow, initial: res };
    }
    return res;
  }

  async cloneBoard(roomId, boardName, sourceBoardId, xOffset = 0, yOffset = 0) {
    const boards = await this.listBoards(roomId);
    const validBoards = boards.filter((b) => hasValidId(b));
    const source = sourceBoardId
      ? validBoards.find((b) => b.id === sourceBoardId)
      : validBoards.find((b) => b.name === 'Welcome board!') || validBoards[0];

    if (!source || !source.id) {
      throw new Error('Aucun board source valide pour clonage');
    }

    const clone = { ...source };
    clone.id = randomUUID();
    clone.name = boardName;
    clone.container = {
      '@class': 'com.iobeya.dto.EntityReferenceDTO',
      id: roomId,
      type: 'com.iobeya.dto.RoomDTO',
    };
    if (clone.elementContainer?.id) {
      clone.elementContainer = { ...clone.elementContainer, id: randomUUID() };
    }
    if (clone.boardDock?.id) {
      clone.boardDock = { ...clone.boardDock, id: randomUUID() };
    }
    clone.x = (Number(source.x) || 0) + xOffset;
    clone.y = (Number(source.y) || 0) + yOffset;

    const payload = {
      '@class': 'com.iobeya.dto.CloneParamDTO',
      ids: [source.id],
      dtos: [clone],
    };

    return this.request({
      method: 'PUT',
      endpointPath: '/s/j/boards/clone',
      body: payload,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
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

    return this.request({
      method: 'POST',
      endpointPath: '/s/j/elements',
      body: dtos,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  }
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = safeJson(raw, null);
      if (parsed === null) {
        reject(new Error('JSON invalide'));
        return;
      }
      resolve(parsed);
    });
    req.on('error', reject);
  });
}

function serveStatic(reqPath, res) {
  const filePath = reqPath === '/'
    ? path.join(WEB_DIR, 'index.html')
    : path.join(WEB_DIR, reqPath.replace(/^\//, ''));

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
        : 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(PROJECT_ROOT, args.env || '.env');
  const port = Number(args.port || process.env.SEED_WEBAPP_PORT || 8787);

  let runtimeConfig = loadConfig(envPath);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === '/api/config' && req.method === 'GET') {
        writeJson(res, 200, {
          ...runtimeConfig,
          password: runtimeConfig.password ? '********' : '',
        });
        return;
      }

      if (url.pathname === '/api/config' && req.method === 'POST') {
        const body = await parseRequestBody(req);
        runtimeConfig = {
          ...runtimeConfig,
          baseUrl: String(body.baseUrl || runtimeConfig.baseUrl).replace(/\/$/, ''),
          loginPath: String(body.loginPath || runtimeConfig.loginPath),
          username: String(body.username || runtimeConfig.username),
          password: String(body.password || runtimeConfig.password),
          token: String(body.token || runtimeConfig.token || ''),
          roomMaxBoards: Number(body.roomMaxBoards || runtimeConfig.roomMaxBoards || 40),
          roomMaxUsers: Number(body.roomMaxUsers || runtimeConfig.roomMaxUsers || 200),
        };
        writeJson(res, 200, { ok: true, config: { ...runtimeConfig, password: runtimeConfig.password ? '********' : '' } });
        return;
      }

      const client = new IobeyaClient(runtimeConfig);

      if (url.pathname === '/api/health' && req.method === 'GET') {
        const out = await client.health();
        writeJson(res, out.ok ? 200 : 502, out);
        return;
      }

      if (url.pathname === '/api/domains' && req.method === 'GET') {
        const data = await client.listDomains();
        writeJson(res, 200, { ok: true, data });
        return;
      }

      if (url.pathname === '/api/rooms' && req.method === 'GET') {
        const domainId = String(url.searchParams.get('domainId') || '');
        if (!domainId) {
          writeJson(res, 400, { ok: false, error: 'domainId manquant' });
          return;
        }
        const data = await client.listRooms(domainId);
        writeJson(res, 200, { ok: true, data });
        return;
      }

      if (url.pathname === '/api/boards' && req.method === 'GET') {
        const roomId = String(url.searchParams.get('roomId') || '');
        if (!roomId) {
          writeJson(res, 400, { ok: false, error: 'roomId manquant' });
          return;
        }
        const raw = await client.listBoards(roomId);
        const data = raw.filter((b) => hasValidId(b));
        writeJson(res, 200, { ok: true, data, droppedInvalidBoards: raw.length - data.length });
        return;
      }

      if (url.pathname === '/api/create-user' && req.method === 'POST') {
        const body = await parseRequestBody(req);
        const out = await client.createUser(body);
        writeJson(res, out.ok ? 200 : 502, {
          ok: out.ok,
          login: out.login,
          state: out.state,
          status: out.status,
          message: out.body?.messages?.[0] || out.body?.result || '',
          response: out,
        });
        return;
      }

      if (url.pathname === '/api/create-room' && req.method === 'POST') {
        const body = await parseRequestBody(req);
        const out = await client.createRoom(body);
        const rooms = body.domainId ? await client.listRooms(body.domainId) : [];
        const found = rooms.find((r) => String(r.name || '').trim() === String(body.name || '').trim()) || null;
        writeJson(res, out.ok || found ? 200 : 502, { ok: Boolean(out.ok || found), response: out, foundRoom: found });
        return;
      }

      if (url.pathname === '/api/create-board' && req.method === 'POST') {
        const body = await parseRequestBody(req);
        const roomId = String(body.roomId || '');
        const boardName = String(body.name || '').trim();
        if (!roomId || !boardName) {
          writeJson(res, 400, { ok: false, error: 'roomId et name requis' });
          return;
        }

        const clone = await client.cloneBoard(
          roomId,
          boardName,
          body.sourceBoardId || null,
          Number(body.xOffset || 0),
          Number(body.yOffset || 0),
        );

        let notesResult = null;
        if (body.addDefaultNotes) {
          const refreshed = await client.listBoards(roomId);
          const created = refreshed.find((b) => String(b.name || '').trim() === boardName && hasValidId(b));
          if (created?.elementContainer?.id) {
            const notes = Array.isArray(body.notes) && body.notes.length > 0
              ? body.notes
              : buildNotesTemplate(String(body.templateKey || 'standup'), boardName);
            notesResult = await client.createBoardNotes(created.elementContainer.id, [
              ...notes,
            ]);
          }
        }

        writeJson(res, clone.ok ? 200 : 502, { ok: clone.ok, clone, notes: notesResult });
        return;
      }

      if (url.pathname === '/api/quick-populate' && req.method === 'POST') {
        const body = await parseRequestBody(req);
        const domainId = String(body.domainId || '').trim();
        if (!domainId) {
          writeJson(res, 400, { ok: false, error: 'domainId manquant' });
          return;
        }

        const now = Date.now();
        const usersCount = Math.max(0, Math.min(50, Number(body.usersCount ?? 4)));
        const roomsCount = Math.max(1, Math.min(20, Number(body.roomsCount ?? 2)));
        const boardsPerRoom = Math.max(1, Math.min(20, Number(body.boardsPerRoom ?? 3)));
        const roomPrefix = String(body.roomPrefix ?? 'Auto Room').trim() || 'Auto Room';
        const userPrefix = String(body.userPrefix ?? 'auto.user').trim() || 'auto.user';
        const includeUsers = body.includeUsers !== false;
        const boardTemplateKey = String(body.boardTemplateKey || 'standup');

        const logs = [];
        const summary = {
          usersCreated: 0,
          usersExisting: 0,
          usersError: 0,
          roomsCreated: 0,
          roomsError: 0,
          boardsCreated: 0,
          boardsError: 0,
        };

        if (includeUsers) {
          for (let i = 1; i <= usersCount; i += 1) {
            const login = `${userPrefix}.${now}.${i}`;
            const userRes = await client.createUser({
              username: login,
              firstName: `Auto${i}`,
              lastName: 'User',
              email: `${login}@example.com`,
              language: 'fr',
              country: 'FR',
            });
            if (userRes.state === 'created') summary.usersCreated += 1;
            else if (userRes.state === 'exists') summary.usersExisting += 1;
            else summary.usersError += 1;
            logs.push({ step: 'user', login, ok: userRes.ok, state: userRes.state, status: userRes.status });
          }
        }

        for (let r = 1; r <= roomsCount; r += 1) {
          const roomName = `${roomPrefix} ${r} ${now}`;
          const roomRes = await client.createRoom({
            name: roomName,
            description: `Room generee ${new Date().toISOString()}`,
            domainId,
          });
          const rooms = await client.listRooms(domainId);
          const foundRoom = rooms.find((x) => String(x.name || '') === roomName);
          logs.push({ step: 'room', roomName, ok: Boolean(foundRoom), status: roomRes.status, roomId: foundRoom?.id || null });
          if (foundRoom?.id) summary.roomsCreated += 1;
          else summary.roomsError += 1;

          if (!foundRoom?.id) continue;

          let sourceBoardId = null;
          for (let b = 1; b <= boardsPerRoom; b += 1) {
            const boardName = `Auto Board ${r}.${b}`;
            const cloneRes = await client.cloneBoard(foundRoom.id, boardName, sourceBoardId, (b - 1) * 260, (r - 1) * 90);
            let notesOk = false;
            if (cloneRes.ok) {
              const clonedId = Array.isArray(cloneRes.body) && cloneRes.body[0]?.id
                ? String(cloneRes.body[0].id)
                : null;
              if (clonedId) sourceBoardId = clonedId;

              const boards = await client.listBoards(foundRoom.id);
              const created = boards.find((x) => String(x.name || '') === boardName);
              if (created?.elementContainer?.id) {
                const notes = await client.createBoardNotes(created.elementContainer.id, buildNotesTemplate(boardTemplateKey, boardName));
                notesOk = notes.ok || notes.status === 201;
              }
            }
            logs.push({ step: 'board', roomId: foundRoom.id, boardName, ok: cloneRes.ok, notesOk, status: cloneRes.status });
            if (cloneRes.ok) summary.boardsCreated += 1;
            else summary.boardsError += 1;
          }
        }

        const ok = logs.every((x) => x.ok !== false);
        writeJson(res, ok ? 200 : 207, { ok, summary, logs });
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
        serveStatic(url.pathname, res);
        return;
      }

      writeJson(res, 404, { ok: false, error: 'Not Found' });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error?.message || String(error),
      });
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[seed-webapp] listening on http://localhost:${port}`);
    console.log(`[seed-webapp] env=${envPath}`);
  });
}

main().catch((error) => {
  console.error('[seed-webapp] fatal:', error.message || error);
  process.exitCode = 1;
});
