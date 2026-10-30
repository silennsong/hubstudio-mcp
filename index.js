#!/usr/bin/env node
// Hubstudio MCP server: environment control via the Hubstudio local API,
// page automation via Playwright over CDP. Several environments can be
// connected at once; page tools act on the active one unless `env` is given.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chromium } from 'playwright-core';

const API = process.env.HUBSTUDIO_API || `http://127.0.0.1:${process.env.HUBSTUDIO_PORT || 6873}`;
const STATUS = { 0: 'open', 1: 'opening', 2: 'closing', 3: 'closed' };

// containerCode -> { code, name, port, browser, context, page }
const sessions = new Map();
let active = null;

async function hub(path, body = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Hubstudio API ${path}: HTTP ${res.status}, non-JSON response`);
  // HTTP 200 is not success; Hubstudio signals errors through `code`.
  if (json.code !== 0) throw new Error(`Hubstudio API ${path}: code ${json.code} ${json.msg || ''}`.trim());
  return json.data;
}

async function listAllEnvs() {
  const all = [];
  for (let current = 1; ; current++) {
    const data = await hub('/api/v1/env/list', { current, size: 200 });
    all.push(...data.list);
    if (all.length >= data.total || data.list.length === 0) return all;
  }
}

// Accepts a containerCode, a serialNumber, or an exact environment name.
async function resolveEnv(ref) {
  const key = String(ref).trim();
  for (const s of sessions.values()) {
    if (String(s.code) === key || s.name === key) return { containerCode: s.code, containerName: s.name };
  }
  const envs = await listAllEnvs();
  const hit = envs.find(e => String(e.containerCode) === key)
    || envs.find(e => e.containerName === key)
    || envs.find(e => String(e.serialNumber) === key);
  if (!hit) throw new Error(`No environment matches "${key}" (tried containerCode, name, serialNumber)`);
  return hit;
}

// User-visible tabs, oldest first (extension background pages excluded).
const liveTabs = (context) => context.pages().filter(p => !p.isClosed() && !p.url().startsWith('chrome-extension://'));
const newestTab = (context) => {
  const tabs = liveTabs(context);
  return tabs.reverse().find(p => p.url() !== 'about:blank' && p.url() !== '') ?? tabs[0];
};

async function getSession(ref) {
  let s;
  if (ref === undefined || ref === null || ref === '') {
    if (!active || !sessions.has(active)) throw new Error('No active environment. Call hub_open_env first.');
    s = sessions.get(active);
  } else {
    const env = await resolveEnv(ref);
    s = sessions.get(String(env.containerCode));
    if (!s) throw new Error(`Environment ${env.containerName} is not connected. Call hub_open_env first.`);
  }
  // The bound tab may have been closed (by the site, the user, or Hubstudio's launch flow).
  if (s.page.isClosed()) s.page = newestTab(s.context) ?? await s.context.newPage();
  return s;
}

async function connect(env, port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = newestTab(context) ?? await context.newPage();
  await page.bringToFront().catch(() => {});
  const code = String(env.containerCode);
  const session = { code, name: env.containerName, port, browser, context, page };
  browser.on('disconnected', () => {
    sessions.delete(code);
    if (active === code) active = sessions.keys().next().value ?? null;
  });
  sessions.set(code, session);
  active = code;
  return session;
}

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const label = (s) => `[${s.name} / ${s.code}]`;

function tool(name, description, shape, handler) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      return await handler(args ?? {});
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: String(err?.message || err) }] };
    }
  });
}

// Locate by CSS/Playwright selector, or by visible text when `text` is given.
// Text prefers links and buttons with that accessible name over plain text,
// so "click Sign in" hits the control rather than a paragraph mentioning it.
async function locate(page, { selector, text: visible, exact }) {
  if (selector) return page.locator(selector).first();
  if (!visible) throw new Error('Provide either selector or text');
  const opts = { name: visible, exact: !!exact };
  for (const loc of [page.getByRole('link', opts), page.getByRole('button', opts), page.getByText(visible, { exact: !!exact })]) {
    const visibleHit = loc.filter({ visible: true });
    if (await visibleHit.count()) return visibleHit.first();
  }
  return page.getByText(visible, { exact: !!exact }).first(); // let the action time out with a clear error
}

const envArg = z.string().optional().describe('Environment (containerCode, name, or serialNumber). Defaults to the active environment.');
const targetArgs = {
  selector: z.string().optional().describe('CSS or Playwright selector, e.g. "input[name=q]" or "role=button[name=Sign in]"'),
  text: z.string().optional().describe('Visible text of the element, used when selector is omitted'),
  exact: z.boolean().optional().describe('Exact text match (default false)'),
};

const server = new McpServer({ name: 'hubstudio', version: '0.1.0' });

// ---------- Environment management ----------

tool('hub_list_envs', 'List Hubstudio environments with their open/closed status. Filter by keyword (matches name, tag, remark, serial number).', {
  keyword: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional().describe('Max rows returned (default 50)'),
}, async ({ keyword, limit = 50 }) => {
  let envs = await listAllEnvs();
  if (keyword) {
    const k = keyword.toLowerCase();
    envs = envs.filter(e => [e.containerName, e.tagName, e.remark, e.serialNumber].some(v => String(v ?? '').toLowerCase().includes(k)));
  }
  const total = envs.length;
  envs = envs.slice(0, limit);
  const status = envs.length
    ? (await hub('/api/v1/browser/all-browser-status', { containerCodes: envs.map(e => String(e.containerCode)) })).containers
    : [];
  const byCode = new Map(status.map(c => [String(c.containerCode), STATUS[c.status] ?? c.status]));
  return text({
    total,
    shown: envs.length,
    envs: envs.map(e => ({
      containerCode: String(e.containerCode),
      serialNumber: e.serialNumber,
      name: e.containerName,
      tag: e.tagName,
      proxy: e.proxyHost ? `${e.proxyTypeName} ${e.proxyHost}:${e.proxyPort}` : e.proxyTypeName,
      lastIp: e.lastUsedIp,
      status: byCode.get(String(e.containerCode)),
      connected: sessions.has(String(e.containerCode)),
      remark: e.remark,
    })),
  });
});

tool('hub_open_env', 'Open (launch) a Hubstudio environment and connect to it for automation. It becomes the active environment.', {
  env: z.string().describe('containerCode, exact environment name, or serialNumber'),
  urls: z.array(z.string()).optional().describe('URLs to open on launch'),
  headless: z.boolean().optional(),
}, async ({ env: ref, urls, headless }) => {
  const env = await resolveEnv(ref);
  const code = String(env.containerCode);
  if (sessions.has(code)) {
    active = code;
    return text(`${label(sessions.get(code))} already connected; set as active.`);
  }
  const body = { containerCode: code };
  if (headless) { body.isHeadless = true; body.args = ['--headless=new']; }
  let data;
  try {
    data = await hub('/api/v1/browser/start', body);
  } catch (err) {
    if (/code -10013\b/.test(err.message)) {
      throw new Error(`${env.containerName} is already open in the Hubstudio client. Close it there first (attaching to a manually opened environment needs extra API permission from Hubstudio support), then retry.`);
    }
    if (/code 26\b/.test(err.message)) throw new Error(`${err.message} — the current Hubstudio plan does not allow opening environments via API.`);
    throw err;
  }
  const s = await connect(env, data.debuggingPort);
  // Open URLs ourselves rather than via containerTabs: Hubstudio opens those in
  // extra tabs at an unpredictable moment, so the bound tab would stay blank.
  for (const [i, url] of (urls ?? []).entries()) {
    if (i > 0) s.page = await s.context.newPage();
    await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  return text({ connected: label(s), debuggingPort: data.debuggingPort, ip: data.ip, url: s.page.url(), activeEnvs: [...sessions.values()].map(label) });
});

tool('hub_close_env', 'Close a Hubstudio environment (disconnect automation and shut the browser).', {
  env: envArg,
}, async ({ env: ref }) => {
  if (!ref && !active) throw new Error('No environment given and none active.');
  const env = ref ? await resolveEnv(ref) : { containerCode: active, containerName: sessions.get(active).name };
  const code = String(env.containerCode), name = env.containerName;
  const s = sessions.get(code);
  if (s) await s.browser.close().catch(() => {}); // over CDP this only drops the connection
  sessions.delete(code);
  if (active === code) active = sessions.keys().next().value ?? null;
  await hub('/api/v1/browser/stop', { containerCode: code });
  return text(`Closed ${name} (${code}). Active: ${active ? label(sessions.get(active)) : 'none'}`);
});

tool('hub_switch_env', 'Make a connected environment the active one for page tools.', {
  env: z.string(),
}, async ({ env: ref }) => {
  const s = await getSession(ref);
  active = s.code;
  return text(`Active: ${label(s)} — ${s.page.url()}`);
});

tool('hub_connected_envs', 'List environments currently connected in this MCP session, with their current tab.', {}, async () => {
  const rows = [];
  for (const s of sessions.values()) {
    rows.push({ env: label(s), active: s.code === active, url: s.page.url(), title: await s.page.title().catch(() => '') });
  }
  return text(rows.length ? rows : 'No environments connected.');
});

// ---------- Tabs ----------

tool('hub_tabs', 'List tabs of an environment, or switch/open/close a tab.', {
  env: envArg,
  action: z.enum(['list', 'select', 'new', 'close']).optional().describe('Default list'),
  index: z.number().int().optional().describe('Tab index for select/close'),
  url: z.string().optional().describe('URL for new tab'),
}, async ({ env, action = 'list', index, url }) => {
  const s = await getSession(env);
  const pages = () => liveTabs(s.context);
  if (action === 'new') {
    s.page = await s.context.newPage();
    if (url) await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  } else if (action === 'select' || action === 'close') {
    const p = pages()[index ?? -1];
    if (!p) throw new Error(`No tab at index ${index}`);
    if (action === 'select') { s.page = p; await p.bringToFront(); }
    else { await p.close(); if (s.page === p) s.page = pages()[0] ?? await s.context.newPage(); }
  }
  const list = await Promise.all(pages().map(async (p, i) => ({ index: i, current: p === s.page, url: p.url(), title: await p.title().catch(() => '') })));
  return text({ env: label(s), tabs: list });
});

// ---------- Page automation ----------

tool('hub_navigate', 'Navigate the current tab to a URL.', {
  env: envArg,
  url: z.string(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
  timeoutMs: z.number().int().optional().describe('Default 60000; proxies can be slow'),
}, async ({ env, url, waitUntil = 'domcontentloaded', timeoutMs = 60000 }) => {
  const s = await getSession(env);
  const res = await s.page.goto(url, { waitUntil, timeout: timeoutMs });
  return text(`${label(s)} ${res?.status() ?? ''} ${s.page.url()} — ${await s.page.title()}`);
});

tool('hub_click', 'Click an element by selector or visible text.', {
  env: envArg, ...targetArgs,
  timeoutMs: z.number().int().optional(),
}, async ({ env, timeoutMs = 15000, ...t }) => {
  const s = await getSession(env);
  const el = await locate(s.page, t);
  const what = await el.evaluate(n => `<${n.tagName.toLowerCase()}> "${(n.innerText || n.value || '').trim().slice(0, 60)}"${n.closest('a')?.href ? ` -> ${n.closest('a').href.slice(0, 100)}` : ''}`).catch(() => '');
  // Links may open a new tab; follow only popups opened by this page (Hubstudio opens unrelated tabs of its own).
  const popup = s.page.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
  await el.click({ timeout: timeoutMs });
  const opened = await popup;
  if (opened) { s.page = opened; await opened.waitForLoadState('domcontentloaded').catch(() => {}); }
  else await s.page.waitForLoadState('domcontentloaded').catch(() => {});
  return text(`${label(s)} clicked ${what}${opened ? ' (opened new tab, switched to it)' : ''}. Now at ${s.page.url()}`);
});

tool('hub_fill', 'Fill an input/textarea (replaces its content). Optionally press Enter after.', {
  env: envArg, ...targetArgs,
  value: z.string(),
  submit: z.boolean().optional().describe('Press Enter after filling'),
}, async ({ env, value, submit, ...t }) => {
  const s = await getSession(env);
  const el = await locate(s.page, t);
  await el.fill(value, { timeout: 15000 });
  if (submit) await el.press('Enter');
  return text(`${label(s)} filled${submit ? ' and submitted' : ''}.`);
});

tool('hub_press_key', 'Press a keyboard key or chord on the current page, e.g. "Enter", "Control+A".', {
  env: envArg,
  key: z.string(),
}, async ({ env, key }) => {
  const s = await getSession(env);
  await s.page.keyboard.press(key);
  return text(`${label(s)} pressed ${key}.`);
});

tool('hub_select_option', 'Choose an option in a <select> element.', {
  env: envArg, ...targetArgs,
  value: z.string().describe('Option value or label'),
}, async ({ env, value, ...t }) => {
  const s = await getSession(env);
  const el = await locate(s.page, t);
  const chosen = await el.selectOption(value).catch(() => el.selectOption({ label: value }));
  return text(`${label(s)} selected ${chosen.join(', ')}.`);
});

tool('hub_hover', 'Hover over an element.', { env: envArg, ...targetArgs }, async ({ env, ...t }) => {
  const s = await getSession(env);
  await (await locate(s.page, t)).hover({ timeout: 15000 });
  return text(`${label(s)} hovered.`);
});

tool('hub_scroll', 'Scroll the page by pixels, or scroll an element into view.', {
  env: envArg, ...targetArgs,
  dy: z.number().optional().describe('Vertical pixels (default 800) when no element is given'),
}, async ({ env, dy = 800, ...t }) => {
  const s = await getSession(env);
  if (t.selector || t.text) await (await locate(s.page, t)).scrollIntoViewIfNeeded();
  else await s.page.mouse.wheel(0, dy);
  return text(`${label(s)} scrolled.`);
});

tool('hub_wait', 'Wait for an element to appear, or for a fixed time.', {
  env: envArg, ...targetArgs,
  ms: z.number().int().optional().describe('Fixed wait when no element is given (default 2000)'),
  timeoutMs: z.number().int().optional(),
}, async ({ env, ms = 2000, timeoutMs = 30000, ...t }) => {
  const s = await getSession(env);
  if (t.selector || t.text) await (await locate(s.page, t)).waitFor({ timeout: timeoutMs });
  else await s.page.waitForTimeout(ms);
  return text(`${label(s)} ready at ${s.page.url()}`);
});

tool('hub_screenshot', 'Screenshot the current tab (viewport, full page, or one element).', {
  env: envArg, ...targetArgs,
  fullPage: z.boolean().optional(),
}, async ({ env, fullPage, ...t }) => {
  const s = await getSession(env);
  const buf = (t.selector || t.text)
    ? await (await locate(s.page, t)).screenshot()
    : await s.page.screenshot({ fullPage: !!fullPage, type: 'jpeg', quality: 70 });
  return { content: [
    { type: 'text', text: `${label(s)} ${s.page.url()}` },
    { type: 'image', data: buf.toString('base64'), mimeType: (t.selector || t.text) ? 'image/png' : 'image/jpeg' },
  ] };
});

tool('hub_get_text', 'Get visible text of the page or of one element (truncated).', {
  env: envArg, ...targetArgs,
  maxChars: z.number().int().optional().describe('Default 8000'),
}, async ({ env, maxChars = 8000, ...t }) => {
  const s = await getSession(env);
  const body = (t.selector || t.text) ? await (await locate(s.page, t)).innerText() : await s.page.locator('body').innerText();
  const out = body.replace(/\n{3,}/g, '\n\n');
  return text(`${label(s)} ${s.page.url()} — ${await s.page.title()}\n\n${out.slice(0, maxChars)}${out.length > maxChars ? `\n…(${out.length - maxChars} more chars)` : ''}`);
});

tool('hub_get_html', 'Get HTML of the page or of one element (truncated).', {
  env: envArg, ...targetArgs,
  maxChars: z.number().int().optional().describe('Default 20000'),
}, async ({ env, maxChars = 20000, ...t }) => {
  const s = await getSession(env);
  const html = (t.selector || t.text) ? await (await locate(s.page, t)).evaluate(el => el.outerHTML) : await s.page.content();
  return text(html.slice(0, maxChars) + (html.length > maxChars ? `\n…(${html.length - maxChars} more chars)` : ''));
});

tool('hub_list_interactive', 'List clickable/fillable elements on the page with a ready-to-use selector, to help pick targets.', {
  env: envArg,
  limit: z.number().int().optional().describe('Default 80'),
}, async ({ env, limit = 80 }) => {
  const s = await getSession(env);
  const items = await s.page.evaluate((limit) => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const sel = el => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      for (const a of ['name', 'aria-label', 'placeholder', 'data-testid']) {
        const v = el.getAttribute(a);
        if (v) return `${el.tagName.toLowerCase()}[${a}=${JSON.stringify(v)}]`;
      }
      return null;
    };
    return [...document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]')]
      .filter(visible).slice(0, limit).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 80) || undefined,
        href: el.getAttribute('href')?.slice(0, 120) || undefined,
        selector: sel(el) || undefined,
      }));
  }, limit);
  return text({ env: label(s), url: s.page.url(), elements: items });
});

tool('hub_evaluate', 'Run JavaScript in the page and return the result (JSON-serialisable). The script is an expression or function body with `return`.', {
  env: envArg,
  script: z.string(),
}, async ({ env, script }) => {
  const s = await getSession(env);
  // A string goes through CDP Runtime.evaluate, which is not subject to page CSP.
  const src = /\breturn\b/.test(script) ? `(async () => { ${script} })()` : script;
  const result = await s.page.evaluate(src);
  return text(result === undefined ? 'undefined' : result);
});

const transport = new StdioServerTransport();
await server.connect(transport);
