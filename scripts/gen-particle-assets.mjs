// 构建期脚本：从 Mojang 官方镜像（piston-meta）拉取指定 Minecraft 版本客户端 jar，
// 提取粒子贴图 + 粒子类型全集，铺平进 public/particles/<version>/，并 upsert 进
// src/render/particleData.ts（版本 → { 类型全集, 类型→帧贴图表 }）。
//
// 支持版本：1.21.11 / 26.2（SUPPORTED 常量）。
//
// 为什么需要它（贴图与类型表从哪来）：
//  - 粒子贴图随客户端 jar 发行（client.jar 内 assets/minecraft/textures/particle/，
//    单粒子单 PNG，帧动画为 prefix_N.png 系列）。
//  - 哪些类型用哪些贴图由 data-driven JSON 定义（client.jar 内 assets/minecraft/particles/*.json
//    的 "textures" 数组，如 end_rod → glitter_0..7）；无 JSON 的类型由客户端字节码
//    硬编码（block/dust/item 等按方块纹理实时取，本脚本不覆盖，渲染层回退软圆点）。
//  - 因此本脚本同时读取「贴图」「JSON 类型表」与「字节码内置注册」，产物是
//    **类型名 → 帧文件列表** 的完整映射 + **类型全集**（JSON ∪ 内置），
//    与 MC 客户端加载语义一致（同纹理列表、同帧序）。
//
// 内置注册来源（按版本两种路径，都只信字节码不信记忆）：
//  - 26.2：混淆 jar 保留了可读类名，注册表在 net/minecraft/core/particles/ParticleTypes
//    的 <clinit>（register 调用逐字核对）。
//  - 1.21.11：混淆更彻底（类名是单字母/短名）。先定位注册类 = 同时引用
//    "explosion_emitter"（内置专用，无 JSON）与 "campfire_cosy_smoke" 的 class，
//    再解析其 <clinit> 里 ldc 粒子名 → iconst_* 的 register 调用序列
//    （(String,Z) 与 (String,Z,Function,Function) 两种形态，flag 位与类型无关，仅取名字）。
//
// 用法：
//  - npm run assets "1.21.11"   或   npm run assets "26.2"
//    优先用本地 client.jar（MC 安装目录，默认 %APPDATA%/.minecraft/versions/<v>/<v>.jar，
//    可用 MC_JAR 环境变量覆盖）；否则从官方镜像下载并校验 sha1。
//  - 1.21.11 的注册类解析依赖 javap（JDK 在 PATH）；26.2 亦走同一字节码路径。
//  - 产物（public/particles/<version>/ + particleData.ts）提交进仓库 →
//    日常构建零网络依赖；渲染层发现映射缺失的类型自动回退软圆点。
//
// 版本与 sha1 以 piston-meta 版本清单实时校验为准（下方 SHA1 常量仅作下载前防漂移提示）。
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUPPORTED = ['1.21.11', '26.2'];
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const OUT_DIR = 'public/particles';
const OUT_TS = 'src/render/particleData.ts';
const TMP_DIR = join(dirname(fileURLToPath(import.meta.url)), '.mc_extract');

/** 已知 client.jar sha1（piston-meta 抓取于 2026-09；实际校验以实时清单为准） */
const KNOWN_SHA1 = {
  '1.21.11': 'ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd',
  '26.2': '2dc72797acbc1b63fc16a11c4ac393605f453754',
};

/** 本地 MC 安装里 <version> client.jar 的默认位置 */
function defaultLocalJar(version) {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(base, '.minecraft', 'versions', version, `${version}.jar`);
  }
  return join(homedir(), '.minecraft', 'versions', version, `${version}.jar`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return await res.json();
}

function sha1OfFile(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

/** 从版本清单取 client.jar 下载信息（url + sha1） */
async function clientDownload(version) {
  const list = await fetchJson(MANIFEST_URL);
  const entry = (list.versions ?? []).find((v) => v.id === version);
  if (!entry) throw new Error(`版本清单里没有 ${version}`);
  const manifest = await fetchJson(entry.url);
  const dl = manifest.downloads.client;
  if (!dl?.url) throw new Error(`${version} 清单无 client 下载`);
  return dl;
}

/** 解 jar（zip）到 outDir：优先 PowerShell System.IO.Compression（Windows，支持全部标准压缩）。 */
function unzipJar(jarPath, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (process.platform === 'win32') {
    const win = (p) => p.replace(/\\/g, '/');
    const pw =
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${win(jarPath)}', '${win(outDir)}')`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', pw], { stdio: 'pipe' });
    return;
  }
  execFileSync('unzip', ['-q', '-o', jarPath, '-d', outDir], { stdio: 'pipe' });
}

/** javap 反汇编指定类（-c -p：含静态块与私有成员） */
function javap(clsPath) {
  return execFileSync('javap', ['-c', '-p', clsPath], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

/** 从 <clinit> 字节码提取内置 register 的粒子名序列：
 *  形态 = `ldc String <name>` + `iconst_0|1`（+ 可选 invokedynamic 双 Function）
 *  + invokestatic a:(String,Z... )。只取名字；flag 位与类型名无对应关系。 */
function extractRegisteredNames(javapText) {
  const lines = javapText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*static \{\};/.test(l));
  if (start < 0) throw new Error('未找到 <clinit> 静态块');
  const block = lines.slice(start);
  const names = [];
  for (let i = 0; i < block.length; i++) {
    const m = block[i].match(/ldc(?:_w)?\s+#\d+\s+\/\/ String (\S+)\r?$/);
    if (!m) continue;
    const next = (block[i + 1] || '').trim();
    if (!/iconst_[01]$/.test(next)) continue; // 不是 register(name, flag) 形态
    names.push(m[1]);
  }
  return names;
}

/** 内置注册类定位：
 *  - 优先可读名 net/minecraft/core/particles/ParticleTypes（26.2）；
 *  - 否则在全部 class 里找同时引用两个特征常量者（1.21.11 混淆名）：
 *    "explosion_emitter"（内置专用、无 JSON）+ "campfire_cosy_smoke"。
 *  返回反汇编文本。 */
function registryJavap(extracted) {
  const pretty = join(extracted, 'net', 'minecraft', 'core', 'particles', 'ParticleTypes.class');
  if (existsSync(pretty)) return javap(pretty);
  // 混淆路径：扫描 class 的常量区（找两个特征串都出现的文件）。
  // 注意：readdirSync 的 Dirent 在 Windows 上不暴露可靠 size，需 statSync 取大小。
  const A = 'explosion_emitter';
  const B = 'campfire_cosy_smoke';
  const found = [];
  const stack = [extracted];
  let scanned = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        stack.push(join(dir, e.name));
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.class')) continue;
      const p = join(dir, e.name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.size > 512 * 1024) continue;
      const buf = readFileSync(p);
      if (buf.includes(A) && buf.includes(B)) found.push(p);
      scanned++;
    }
  }
  if (scanned === 0) throw new Error('内置注册类定位失败：未扫描到任何 class（解压路径异常？）');
  if (found.length !== 1) {
    throw new Error(`内置注册类定位失败：命中 ${found.length} 个（期望 1）：${found.slice(0, 3).join(', ')}`);
  }
  return javap(found[0]);
}

/** particleData.ts upsert：读现有文件（按对象字面量定位目标版本条目）→ 合并/替换 → 重写。
 *  文件不存在时自举骨架（首个版本条目由追加分支写入）。 */
function upsertVersionTs(path, version, entry) {
  const marker = 'export const PARTICLE_DATA: Record<string, ParticleVersionData> = {';
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!text.includes(marker)) {
    if (existsSync(path)) throw new Error('particleData.ts 缺少 PARTICLE_DATA 标记，格式已变？');
    text = `// 由 scripts/gen-particle-assets.mjs 生成（Minecraft 1.21.11 / 26.2 客户端 jar）。
// 每个版本一条目：
//  - types：内置粒子类型全集（字节码 <clinit> 内置注册 ∪ assets/minecraft/particles/*.json
//    data-driven 类型；'type' 是 type{NBT} 复合语法前缀、非类型名，已排除）
//    → UI 表单粒子名下拉建议。
//  - frames：类型名 → 帧贴图列表（public/particles/<version>/<帧>.png，帧序与 MC 客户端
//    一致，帧动画时长按 MC 客户端惯例 1/20 s/帧）。未收录类型（block/dust/item 等按
//    方块纹理实时渲染的类型、未知名）→ undefined，渲染层回退软圆点。
export interface ParticleVersionData {
  types: string[];
  frames: Record<string, string[]>;
}

${marker}
};
`;
  }
  const objStart = text.indexOf(marker) + marker.length;
  // 对象字面量 = marker 末尾的 { 起配平到对应 }（marker 末字符就是开括号）
  let depth = 0, objEnd = -1;
  for (let i = objStart - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { objEnd = i; break; } }
  }
  if (objEnd < 0) throw new Error('particleData.ts 对象字面量解析失败');
  const objText = text.slice(objStart, objEnd + 1);

  const entryRe = new RegExp(`\\n  ${JSON.stringify(version)}: \\{`);
  const m = objText.match(entryRe);
  let body;
  if (m) {
    // 取该条目的对象体（配平花括号）
    let i = objText.indexOf('{', m.index + 1);
    let d = 0, e = -1;
    for (; i < objText.length; i++) {
      if (objText[i] === '{') d++;
      else if (objText[i] === '}') { d--; if (d === 0) { e = i; break; } }
    }
    body = objText.slice(0, m.index) + entryBody(version, entry) + objText.slice(e + 1);
  } else {
    body = objText.slice(0, -1) + '\n' + entryBody(version, entry) + ' }';
  }
  const next = text.slice(0, objStart) + body + text.slice(objEnd + 1);
  writeFileSync(path, next);
  return next;
}

function entryBody(version, entry) {
  const types = entry.types.map((t) => `${JSON.stringify(t)},`).join('\n    ');
  const frames = Object.entries(entry.frames)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `    ${JSON.stringify(k)}: [${v.map((f) => JSON.stringify(f)).join(', ')}],`)
    .join('\n');
  return `\n  ${JSON.stringify(version)}: {\n    types: [\n${types}\n    ],\n    frames: {\n${frames}\n    },\n  },`;
}

async function main() {
  const version = process.argv[2] ?? '';
  if (!SUPPORTED.includes(version)) {
    throw new Error(`用法：node gen-particle-assets.mjs <${SUPPORTED.join(' | ')}>（收到 "${version}"）`);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, OUT_DIR, version);
  const outTs = join(root, OUT_TS);

  // 1. 定位 client.jar：MC_JAR > 本地 MC 安装 > 官方镜像下载（sha1 双校验）
  let jarPath = process.env.MC_JAR ?? '';
  if (jarPath && !existsSync(jarPath)) throw new Error(`指定的 client.jar 不存在：${jarPath}`);
  if (!jarPath && existsSync(defaultLocalJar(version))) {
    jarPath = defaultLocalJar(version);
    console.log(`[assets:${version}] 使用本地 MC client.jar：${jarPath}`);
  }
  const dl = await clientDownload(version);
  if (!jarPath) {
    if (KNOWN_SHA1[version] && dl.sha1 !== KNOWN_SHA1[version]) {
      throw new Error(`${version} client jar sha1 与已知值漂移（清单 ${dl.sha1}）：确认 Mojang 未更新客户端后更新 KNOWN_SHA1`);
    }
    console.log(`[assets:${version}] 本地无 jar，从官方镜像下载 client.jar`);
    jarPath = join(TMP_DIR, `client-${version}.jar`);
    mkdirSync(TMP_DIR, { recursive: true });
    const res = await fetch(dl.url);
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${dl.url}`);
    writeFileSync(jarPath, Buffer.from(await res.arrayBuffer()));
  }
  if (sha1OfFile(jarPath) !== dl.sha1) throw new Error('jar sha1 校验失败，需要正确的 client jar');
  console.log(`[assets:${version}] sha1 校验通过（${dl.sha1}）`);

  // 2. 解 jar（只解需要的子树以省时：assets + net/minecraft；混淆版类在根下短名包，
  //    1.21.11 需全量 class 扫描 → 整包解压）
  const extracted = join(TMP_DIR, `jar-${version}`);
  unzipJar(jarPath, extracted);
  const texDir = join(extracted, 'assets', 'minecraft', 'textures', 'particle');
  const jsonDir = join(extracted, 'assets', 'minecraft', 'particles');
  if (!existsSync(texDir)) throw new Error('jar 内无 textures/particle/（版本不符？）');

  // 3. 收集全部粒子贴图文件（帧存在性校验用）
  const texFiles = new Set(readdirSync(texDir).filter((f) => f.endsWith('.png')));
  if (texFiles.size < 50) throw new Error(`粒子贴图仅 ${texFiles.size} 张，疑似 jar 版本不符`);

  // 4. 读取 data-driven 类型表（assets/minecraft/particles/*.json → "textures" 数组）
  const jsonMap = new Map();
  if (existsSync(jsonDir)) {
    for (const f of readdirSync(jsonDir)) {
      if (!f.endsWith('.json')) continue;
      const type = f.slice(0, -5);
      let j;
      try {
        j = JSON.parse(readFileSync(join(jsonDir, f), 'utf8'));
      } catch {
        continue;
      }
      if (!Array.isArray(j.textures)) continue;
      const frames = j.textures.map((t) => String(t).replace(/^minecraft:/, ''));
      if (frames.length) jsonMap.set(type, frames);
    }
  }
  console.log(`[assets:${version}] data-driven 类型 ${jsonMap.size} 个（JSON "textures" 表）`);

  // 5. 内置注册（字节码 <clinit> 逐字核对）；全集 = 注册 ∪ JSON
  const registryNames = extractRegisteredNames(registryJavap(extracted));
  if (registryNames.length < 50) throw new Error(`内置注册仅 ${registryNames.length} 个，解析疑似失败`);
  const builtinOnly = registryNames.filter((n) => !jsonMap.has(n) && n !== 'type');
  console.log(`[assets:${version}] 内置注册 ${registryNames.length} 个（无 JSON：${builtinOnly.join(', ')}）`);

  // 6. 校验帧文件存在（缺帧 = MC 客户端会 warn "Missing particle sprites"）
  const missing = [];
  for (const [type, frames] of jsonMap) {
    for (const f of frames) if (!texFiles.has(`${f}.png`)) missing.push(`${type}→${f}`);
  }
  if (missing.length) throw new Error(`帧文件缺失 ${missing.length} 个（前 8）：${missing.slice(0, 8).join(', ')}`);

  // 7. 铺平贴图到 public/particles/<version>/（只铺被类型表引用的文件，控制体积）
  const used = new Set();
  for (const frames of jsonMap.values()) for (const f of frames) used.add(`${f}.png`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of used) copyFileSync(join(texDir, f), join(outDir, f));
  console.log(`[assets:${version}] 写出 ${used.size} 张贴图 → ${OUT_DIR}/${version}/`);

  // 8. upsert particleData.ts（该版本条目：类型全集 + 帧表）
  const allTypes = [...new Set([...registryNames, ...jsonMap.keys()])]
    .filter((t) => t !== 'type')
    .sort((a, b) => a.localeCompare(b));
  upsertVersionTs(outTs, version, { types: allTypes, frames: Object.fromEntries(jsonMap) }, SUPPORTED);
  console.log(`[assets:${version}] upsert ${OUT_TS}（${allTypes.length} 类型，${jsonMap.size} 帧表条目）`);

  rmSync(TMP_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`[assets] 失败：${e.message}`);
  process.exit(1);
});
