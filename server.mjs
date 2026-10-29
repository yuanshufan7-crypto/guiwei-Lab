import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecognizer, loadEnvFile, MIME_BY_EXT, RECOGNITION_MODES, ASSESSMENTS } from './server/recognizer.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const photo = '/images/toolkit.png';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const string = (v, label, max = 120) => typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : fail(`${label}不能为空，且不能超过 ${max} 字`);
const integer = (v, min = 0, max = 99) => Number.isInteger(v) && v >= min && v <= max ? v : fail(`数量必须为 ${min}—${max} 的整数`);
const safePhoto = v => typeof v === 'string' && (/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v) || v === photo) ? v : fail('请先上传照片或选择示例照片');
const clone = v => JSON.parse(JSON.stringify(v));

export function seedDatabase() {
  const items = [
    { id:'tool-1', name:'十字螺丝刀', spec:'PH2 · 100 mm', quantity:1, icon:'screwdriver', referencePhoto:photo },
    { id:'tool-2', name:'一字螺丝刀', spec:'SL5 · 100 mm', quantity:1, icon:'screwdriver', referencePhoto:photo },
    { id:'tool-3', name:'钢丝钳', spec:'6 英寸 · 绝缘手柄', quantity:1, icon:'pliers', referencePhoto:photo },
    { id:'tool-4', name:'活动扳手', spec:'8 英寸 · 开口可调', quantity:1, icon:'wrench', referencePhoto:photo },
    { id:'tool-5', name:'数字万用表', spec:'含红黑表笔', quantity:1, icon:'meter', referencePhoto:photo }
  ];
  const kit = { id:'kit-001', name:'基础电工工具套装', code:'KIT-001', location:'工程实训中心 · A302', description:'适用于基础电路实验、设备拆装与日常检修。', copies:3, photo, items, createdAt:'2026-10-25T09:00:00+08:00' };
  const make = (id, borrower, studentId, status, date, due) => ({ id, code:`GW-202610-${id.slice(-3)}`, kitId:kit.id, kitName:kit.name, kitCode:kit.code, borrower, studentId, purpose:'基础电路实验', borrowedAt:`2026-10-${date}T02:30:00.000Z`, dueAt:`2026-10-${due}T10:00:00.000Z`, borrowPhoto:photo, samplePhoto:true, items:clone(items).map(i=>({...i, confirmed:true})), status, returnDraft:null, returnedAt:null });
  const pending = make('seed-002','林晓','2024010208','review','27','29');
  pending.returnDraft = { photo, samplePhoto:true, items:items.map(i=>({id:i.id, returnedQuantity:i.id==='tool-4'?0:1, verdict:i.id==='tool-4'?'missing':'checked', confirmed:i.id!=='tool-4'})), note:'活动扳手暂未找到，待补交后核验。', savedAt:'2026-10-28T01:20:00.000Z' };
  const complete = make('seed-001','陈雨','2023010612','returned','26','27');
  complete.returnDraft = {photo, samplePhoto:true, items:items.map(i=>({id:i.id, returnedQuantity:1, verdict:'checked', confirmed:true})), note:'逐项核对，器材齐全。', savedAt:'2026-10-27T06:10:00.000Z'};
  complete.returnedAt='2026-10-27T06:10:00.000Z';
  // 初次体验即可看到识别来源与核验历史：仅使用明确标注的演示来源（demo / demo-sample），绝不写 live。
  const demoItem = (item, observedQuantity, assessment, evidence) => ({ itemId:item.id, name:item.name, expectedQuantity:item.quantity, observedQuantity, assessment, evidence });
  const demoWarnings = ['当前为演示结果：内容为固定示例，没有分析照片内容。请以人工核对为准。'];
  pending.recognition = { mode:'demo', provider:'demo-sample', model:'', stage:'borrow', photo, recognizedAt:'2026-10-27T02:35:00.000Z', quality:{status:'demo',reasons:['演示结果：固定示例，未分析照片内容']}, items:items.map(i=>demoItem(i,1,'present','演示数据：按预期清单标记为可见')), unknownObjects:[], warnings:demoWarnings };
  pending.returnDraft.recognition = { mode:'demo', provider:'demo-sample', model:'', stage:'return', photo, recognizedAt:'2026-10-28T01:20:00.000Z', quality:{status:'demo',reasons:['演示结果：固定示例，未分析照片内容']}, items:items.map(i=>i.id==='tool-4'?demoItem(i,0,'missing','演示数据：假定该物品未出现在照片中'):demoItem(i,1,'present','演示数据：按预期清单标记为可见')), unknownObjects:[], warnings:[...demoWarnings,'照片核对结果不能替代人工确认，也不能判断器材功能是否正常。'] };
  pending.verificationLog = [{at:'2026-10-27T02:35:00.000Z',action:'borrow',note:'借出识别来源：demo'},{at:'2026-10-28T01:20:00.000Z',action:'review-save',note:'保存待核验：1 项未核对'}];
  complete.verificationLog = [{at:'2026-10-26T02:30:00.000Z',action:'borrow',note:'借出识别来源：demo'},{at:'2026-10-27T06:10:00.000Z',action:'finalize',note:'完成归还并逐项人工确认'}];
  return { version:1, kits:[kit], records:[make('seed-003','张宇','2024010326','borrowed','28','30'), pending, complete] };
}

async function readBody(req, limit = 12 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail('文件过大，请选择 10 MB 以内的图片', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

const clampText = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// 核验历史上限：超过后保留最近 N 条，并在记录上标记曾发生截断（不再静默丢弃早期事件）。
export const VERIFICATION_LOG_LIMIT = 200;
export function appendVerificationEvent(record, action, note, { at = new Date().toISOString(), limit = VERIFICATION_LOG_LIMIT } = {}) {
  const log = Array.isArray(record.verificationLog) ? record.verificationLog.slice() : [];
  log.push({ at, action, note: typeof note === 'string' ? note.slice(0, 200) : '' });
  if (log.length > limit) {
    record.verificationLog = log.slice(-limit);
    record.verificationLogTruncated = true;
  } else {
    record.verificationLog = log;
  }
  return record.verificationLog;
}

// 只按白名单保存识别信息，避免任意结构写入数据文件；保留 AI 建议原文，不与人工结果混为一体。
export function sanitizeRecognition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const quality = raw.quality && typeof raw.quality === 'object' && !Array.isArray(raw.quality)
    ? { status: clampText(raw.quality.status, 20) || 'ok', reasons: Array.isArray(raw.quality.reasons) ? raw.quality.reasons.filter(r => typeof r === 'string').slice(0, 10).map(r => r.slice(0, 160)) : [] }
    : { status: 'ok', reasons: [] };
  return {
    mode: RECOGNITION_MODES.includes(raw.mode) ? raw.mode : 'unavailable',
    provider: clampText(raw.provider, 40),
    model: clampText(raw.model, 80),
    stage: raw.stage === 'return' ? 'return' : 'borrow',
    photo: typeof raw.photo === 'string' && (/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(raw.photo) || raw.photo === photo) ? raw.photo : '',
    recognizedAt: clampText(raw.recognizedAt, 40) || new Date().toISOString(),
    reason: clampText(raw.reason, 40),
    message: clampText(raw.message || raw.error, 300),
    quality,
    items: Array.isArray(raw.items) ? raw.items.filter(i => i && typeof i === 'object').slice(0, 50).map(i => ({
      itemId: clampText(i.itemId, 64),
      name: clampText(i.name, 50),
      expectedQuantity: Number.isInteger(i.expectedQuantity) ? i.expectedQuantity : null,
      observedQuantity: Number.isInteger(i.observedQuantity) && i.observedQuantity >= 0 ? i.observedQuantity : null,
      assessment: ASSESSMENTS.includes(i.assessment) ? i.assessment : 'uncertain',
      evidence: clampText(i.evidence, 240)
    })) : [],
    unknownObjects: Array.isArray(raw.unknownObjects) ? raw.unknownObjects.filter(o => o && typeof o === 'object').slice(0, 20).map(o => ({ name: clampText(o.name, 80), note: clampText(o.note, 200) })) : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter(w => typeof w === 'string').slice(0, 20).map(w => w.slice(0, 200)) : []
  };
}

/**
 * 应用核心：不依赖 HTTP，可直接在进程内调用，便于自动化测试与浏览器之外的验证。
 * 返回 { handle, state, persist, engine, dataDir }，HTTP 层只是它的薄包装。
 */
export function createLabApp({ dataDir = resolve(root, 'data'), recognizer = null } = {}) {
  mkdirSync(resolve(dataDir, 'uploads'), { recursive:true });
  const databasePath = resolve(dataDir, 'database.json');
  if (!existsSync(databasePath)) writeFileSync(databasePath, JSON.stringify(seedDatabase(), null, 2));
  let db = JSON.parse(readFileSync(databasePath, 'utf8'));
  const persist = () => { const temp = `${databasePath}.tmp`; writeFileSync(temp, JSON.stringify(db, null, 2)); renameSync(temp, databasePath); };
  const hydrate = () => ({ ...clone(db), kits:db.kits.map(k=>({ ...k, available:k.copies-db.records.filter(r=>r.kitId===k.id && r.status!=='returned').length })) });
  const engine = recognizer || createRecognizer();

  const uploadPath = url => resolve(dataDir, 'uploads', url.split('/').at(-1));
  const photoBytesOf = url => url === photo ? readFileSync(resolve(root, 'public', 'images', 'toolkit.png')) : readFileSync(uploadPath(url));
  const resolvePhoto = url => { const safe = safePhoto(url); if (safe.startsWith('/uploads/') && !existsSync(uploadPath(safe))) fail('照片文件不存在，请重新上传'); return safe; };
  const logEvent = (record, action, note) => { appendVerificationEvent(record, action, clampText(note, 200)); };

  async function handle(request = {}) {
    const { method = 'GET', path = '/', json = null, bytes = null } = request;
    try {
      if (path === '/api/health') return { status: 200, body: { ok: true, recognition: engine.info() } };
      if (path === '/api/state' && method === 'GET') return { status: 200, body: hydrate() };

      if (path === '/api/recognize' && method === 'POST') {
        const body = json || {};
        const stage = body.stage === 'return' ? 'return' : body.stage === 'borrow' ? 'borrow' : fail('识别阶段无效，只能是 borrow 或 return');
        let items, kitId = null, recordId = null, scopeName = '';
        if (stage === 'borrow') {
          const kit = db.kits.find(k => k.id === body.kitId); if (!kit) fail('套装不存在', 404);
          items = kit.items; kitId = kit.id; scopeName = kit.name;
        } else {
          const record = db.records.find(r => r.id === body.recordId); if (!record) fail('记录不存在', 404);
          items = record.items; recordId = record.id; scopeName = record.kitName; // 始终使用借出快照，不使用可能已被编辑的当前套装
        }
        const photoUrl = resolvePhoto(body.photo);
        const demo = body.demo === true;
        const demoScenario = typeof body.demoScenario === 'string' ? body.demoScenario : 'uncertain';
        const photoBytes = demo ? null : photoBytesOf(photoUrl);
        const recognition = await engine.recognize({ stage, items, photo: photoUrl, photoBytes, photoMime: MIME_BY_EXT[extname(photoUrl)] || 'image/png', demo, demoScenario });
        return { status: 200, body: { recognition, scope: { kitId, recordId, name: scopeName, itemCount: items.length } } };
      }

      if (path === '/api/uploads' && method === 'POST') {
        if (!bytes || !bytes.length) fail('请选择有效的 JPG、PNG 或 WebP 图片');
        const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
        const webp = bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
        if (!png && !jpg && !webp) fail('请选择有效的 JPG、PNG 或 WebP 图片');
        const file = `${randomUUID()}.${png?'png':jpg?'jpg':'webp'}`;
        writeFileSync(resolve(dataDir,'uploads',file),bytes);
        return { status: 201, body: { url: `/uploads/${file}` } };
      }

      const kitMatch = path.match(/^\/api\/kits(?:\/([^/]+))?$/);
      if (kitMatch && ['POST','PUT'].includes(method)) {
        const body = json || {};
        const existing = kitMatch[1] ? db.kits.find(k=>k.id===kitMatch[1]) : null;
        if(method==='PUT' && !existing) fail('套装不存在',404);
        if (!Array.isArray(body.items) || body.items.length<1 || body.items.length>20) fail('每套需要 1—20 类物品');
        const ids = new Set();
        const items = body.items.map(i=>{ const id = existing?.items.some(x=>x.id===i.id) ? i.id : randomUUID(); if(ids.has(id))fail('物品不能重复'); ids.add(id); return {id, name:string(i.name,'物品名称',50), spec:typeof i.spec==='string'?i.spec.slice(0,80):'', quantity:integer(i.quantity,1), icon:i.icon||'wrench', referencePhoto:i.referencePhoto?safePhoto(i.referencePhoto):photo}; });
        const copies = integer(body.copies,1);
        const active = existing ? db.records.filter(r=>r.kitId===existing.id && r.status!=='returned').length : 0;
        if (copies<active) fail(`当前有 ${active} 套尚未归还，库存不能少于此数量`);
        const kit = {id:existing?.id||randomUUID(), code:existing?.code||`KIT-${String(db.kits.length+1).padStart(3,'0')}`, name:string(body.name,'套装名称',60), location:string(body.location,'存放位置',80), description:typeof body.description==='string'?body.description.slice(0,300):'', copies, photo:body.photo?safePhoto(body.photo):photo, items, createdAt:existing?.createdAt||new Date().toISOString()};
        if(existing) db.kits=db.kits.map(k=>k.id===existing.id?kit:k); else db.kits.unshift(kit);
        persist(); return { status: 201, body: { kit, state: hydrate() } };
      }

      if(path==='/api/records' && method==='POST') {
        const body=json||{};
        const kit=db.kits.find(k=>k.id===body.kitId); if(!kit)fail('套装不存在',404);
        if(db.records.filter(r=>r.kitId===kit.id && r.status!=='returned').length>=kit.copies)fail('该套装已全部借出，请先完成归还核验',409);
        const borrowPhoto=safePhoto(body.photo);
        if(borrowPhoto.startsWith('/uploads/') && !existsSync(uploadPath(borrowPhoto)))fail('照片文件不存在，请重新上传');
        if(!Array.isArray(body.items)||body.items.length!==kit.items.length)fail('请确认完整借出清单');
        const itemIds=new Set(body.items.map(i=>i.id)); if(itemIds.size!==kit.items.length)fail('借出物品不能重复');
        const items=kit.items.map(ref=>{ const i=body.items.find(x=>x.id===ref.id); if(!i || i.confirmed!==true)fail('请人工确认每一项器材'); return {...ref,name:string(i.name,'物品名称',50),quantity:integer(i.quantity,0,ref.quantity),confirmed:true}; }).filter(i=>i.quantity>0);
        if(!items.length)fail('至少需要借用一件器材');
        const due=new Date(body.dueAt); if(Number.isNaN(due.getTime()) || due.getTime()<=Date.now())fail('预计归还时间必须晚于当前时间');
        const record={id:randomUUID(), code:`GW-${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')}-${String(db.records.length+1).padStart(3,'0')}`,kitId:kit.id,kitName:kit.name,kitCode:kit.code,borrower:string(body.borrower,'借用人',40),studentId:string(body.studentId,'学号 / 工号',40),purpose:typeof body.purpose==='string'?body.purpose.slice(0,200):'',borrowedAt:new Date().toISOString(),dueAt:due.toISOString(),borrowPhoto,samplePhoto:body.samplePhoto===true,items,status:'borrowed',returnDraft:null,returnedAt:null,recognition:sanitizeRecognition(body.recognition)};
        logEvent(record,'borrow', record.recognition ? `借出识别来源：${record.recognition.mode}` : '借出登记（未使用识别）');
        db.records.unshift(record); persist(); return { status: 201, body: { record, state: hydrate() } };
      }

      const returnMatch=path.match(/^\/api\/records\/([^/]+)\/return$/);
      if(returnMatch && method==='POST') {
        const body=json||{}; const record=db.records.find(r=>r.id===returnMatch[1]);
        if(!record)fail('记录不存在',404); if(record.status==='returned')fail('该记录已完成归还',409);
        const returnPhoto=safePhoto(body.photo);
        if(returnPhoto.startsWith('/uploads/') && !existsSync(uploadPath(returnPhoto)))fail('照片文件不存在，请重新上传');
        if(!Array.isArray(body.items)||body.items.length!==record.items.length||new Set(body.items.map(i=>i.id)).size!==record.items.length)fail('请核对完整归还清单');
        const items=record.items.map(ref=>{ const i=body.items.find(x=>x.id===ref.id); if(!i || !['checked','missing','uncertain'].includes(i.verdict))fail('核验状态无效'); const returnedQuantity=integer(i.returnedQuantity,0,ref.quantity); if(i.verdict==='checked' && returnedQuantity!==ref.quantity)fail('数量不符的项目不能标记为已核对'); return {id:ref.id,returnedQuantity,verdict:i.verdict,confirmed:i.confirmed===true}; });
        if(body.finalize && items.some(i=>i.verdict!=='checked'||!i.confirmed))fail('仍有缺件或待确认项目，请逐项核验后完成归还');
        record.returnDraft={photo:returnPhoto,samplePhoto:body.samplePhoto===true,items,note:typeof body.note==='string'?body.note.slice(0,500):'',savedAt:new Date().toISOString(),recognition:sanitizeRecognition(body.recognition)};
        record.status=body.finalize?'returned':'review'; if(body.finalize)record.returnedAt=new Date().toISOString();
        logEvent(record, body.finalize?'finalize':'review-save', body.finalize ? '完成归还并逐项人工确认' : `保存待核验：${items.filter(i=>i.verdict!=='checked').length} 项未核对`);
        persist(); return { status: 200, body: { record, state: hydrate() } };
      }

      if(path.startsWith('/api/'))return { status: 404, body: { error:'接口不存在' } };
      if(path.startsWith('/uploads/')) {
        if(!/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(path))fail('文件不存在',404);
        const file=uploadPath(path); if(!existsSync(file))fail('文件不存在',404);
        return { status: 200, bytes: readFileSync(file), contentType: MIME_BY_EXT[extname(file)] || 'application/octet-stream' };
      }
      return { status: 404, body: { error:'页面不存在' } };
    } catch (e) {
      return { status: e.status || (e instanceof SyntaxError ? 400 : 500), body: { error: e.status ? e.message : (e instanceof SyntaxError ? '请求格式无效' : '保存失败，请重试') } };
    }
  }

  return { handle, state: hydrate, persist, engine, dataDir, get db() { return db; } };
}

export async function createLabServer({ dataDir = resolve(root, 'data'), development = false, recognizer = null } = {}) {
  const app = createLabApp({ dataDir, recognizer });
  let vite;
  if (development) { const {createServer} = await import('vite'); vite = await createServer({ root, server:{ middlewareMode:true }, appType:'spa' }); }
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async(req,res) => {
    try {
      const url = new URL(req.url, 'http://localhost'); const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/api/') || path.startsWith('/uploads/')) {
        const binary = path === '/api/uploads' && req.method === 'POST';
        let bytes = null; let json = null;
        if (['POST','PUT'].includes(req.method)) {
          bytes = await readBody(req, binary ? 10 * 1024 * 1024 : 100000);
          if (!binary && bytes.length) json = JSON.parse(bytes.toString());
        }
        const result = await app.handle({ method: req.method, path, json, bytes });
        if (result.bytes) { res.writeHead(result.status, { 'Content-Type': result.contentType, 'X-Content-Type-Options':'nosniff' }); return res.end(result.bytes); }
        return send(res, result.status, result.body);
      }
      if(vite) return vite.middlewares(req,res,()=>send(res,404,{error:'页面不存在'}));
      const publicRoot=resolve(root,'dist'); let file=resolve(publicRoot,'.'+path);
      if(!file.startsWith(publicRoot+'\\')&&!file.startsWith(publicRoot+'/')&&file!==publicRoot)fail('文件不存在',404);
      if(!existsSync(file)||statSync(file).isDirectory())file=resolve(publicRoot,'index.html');
      if(!existsSync(file))fail('请先运行 npm run build',503);
      res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(readFileSync(file));
    } catch(e) { send(res,e.status||((e instanceof SyntaxError)?400:500),{error:e.status?e.message:e instanceof SyntaxError?'请求格式无效':'保存失败，请重试'}); }
  });
  return {server, app, close:async()=>{await new Promise(r=>server.close(r));await vite?.close();}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  loadEnvFile(resolve(root, '.env'));
  const development=process.argv.includes('--dev') || !existsSync(resolve(root,'dist/index.html')) || process.env.LAB_DEV==='1';
  const app=await createLabServer({development});
  const port=Number(process.env.PORT)||4317;
  app.server.listen(port,'127.0.0.1',()=>{
    const info=app.app.engine.info();
    console.log(`归位 Lab 已启动：http://localhost:${port}`);
    console.log(`视觉识别：${info.configured?`已配置（provider=${info.provider}，model=${info.model}）`:'未配置（/api/recognize 将返回 unavailable，可显式使用演示模式）'}`);
  });
  app.server.on('error',e=>{console.error(e.message);process.exit(1);});
  process.on('SIGINT',async()=>{await app.close();process.exit(0);});
}