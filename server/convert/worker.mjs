// MGS convert: следит за новыми изделиями и делает для каждого лёгкую модель GLB (см. convert.mjs).
// Работает внутри сервера: PostgREST и Storage — ключом service_role (он не покидает сервер).
import {convert} from './convert.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const REST = process.env.REST_URL || 'http://rest:3000';
const STORAGE = process.env.STORAGE_URL || 'http://storage:5000';
const KEY = process.env.SERVICE_ROLE_KEY;
const BUCKET = 'models';
const H = {Authorization: `Bearer ${KEY}`, apikey: KEY};
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const base = p => String(p).replace(/\\/g, '/').split('/').filter(Boolean).pop();

async function rest(method, q, body) {
  const r = await fetch(`${REST}/${q}`, {method, headers: {...H, 'Content-Type': 'application/json', Prefer: 'return=representation'},
    body: body ? JSON.stringify(body) : undefined});
  const t = await r.text();
  if (!r.ok) throw new Error(`rest ${method} ${q}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const enc = p => p.split('/').map(encodeURIComponent).join('/');

async function job(item) {
  const files = item.files || [];
  const obj = files.find(f => /\.obj$/i.test(f.name));
  if (!obj) { await rest('PATCH', `items?id=eq.${item.id}`, {glb_status: 'none'}); return; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgs-'));
  try {
    for (const f of files) {
      if (!/\.(obj|mtl|png|jpe?g|bmp|gif|webp|tga)$/i.test(f.name)) continue;
      const r = await fetch(`${STORAGE}/object/${BUCKET}/${enc(f.path)}`, {headers: H});
      if (!r.ok) throw new Error(`файл ${f.name}: ${r.status}`);
      let b = Buffer.from(await r.arrayBuffer());
      if (f.gz) b = zlib.gunzipSync(b);
      await fs.writeFile(path.join(dir, base(f.name)), b);
    }
    const glb = await convert(dir, base(obj.name), m => log(item.id, m));
    const key = `${item.project_id}/${item.id}/model.glb`;
    const up = await fetch(`${STORAGE}/object/${BUCKET}/${enc(key)}`, {method: 'POST',
      headers: {...H, 'Content-Type': 'model/gltf-binary', 'x-upsert': 'true', 'cache-control': 'max-age=31536000'}, body: glb});
    if (!up.ok) throw new Error(`загрузка GLB: ${up.status} ${(await up.text()).slice(0, 200)}`);
    await rest('PATCH', `items?id=eq.${item.id}`, {glb: {path: key, size: glb.length}, glb_status: 'ok', glb_error: null});
    log(item.id, 'готово', key);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
}

async function tick() {
  const list = await rest('GET', 'items?select=id,project_id,files&glb_status=is.null&order=created_at.asc&limit=1');
  if (!list || !list.length) return false;
  const it = list[0];
  // забираем задачу (если вдруг два обработчика — второй не возьмёт)
  const got = await rest('PATCH', `items?id=eq.${it.id}&glb_status=is.null`, {glb_status: 'working'});
  if (!got || !got.length) return true;
  const t0 = Date.now();
  try { await job(it); }
  catch (e) {
    log(it.id, 'ОШИБКА', e.message);
    await rest('PATCH', `items?id=eq.${it.id}`, {glb_status: 'error', glb_error: String(e.message).slice(0, 500)}).catch(() => {});
  }
  log(it.id, `${Date.now() - t0} мс`);
  return true;
}

// задачи, брошенные при перезапуске, — снова в очередь
await rest('PATCH', 'items?glb_status=eq.working', {glb_status: null}).catch(e => log('старт:', e.message));
log('mgs-convert запущен');
for (;;) {
  let busy = false;
  try { busy = await tick(); } catch (e) { log('цикл:', e.message); }
  await new Promise(r => setTimeout(r, busy ? 200 : 4000));
}
