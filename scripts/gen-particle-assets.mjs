// 构建期脚本：从 Mojang 官方镜像（piston-meta）拉取 Minecraft 26.2 客户端 jar，
// 提取粒子贴图，铺平进 public/particles/，并生成 src/render/particleTextures.ts。
//
// 为什么需要它（贴图从哪来）：
//  - 26.2 起粒子贴图随客户端 jar 发行（client.jar 内 assets/minecraft/textures/particle/，
//    单粒子单 PNG，帧动画为 prefix_N.png 系列；不再是旧版 particles.png 图集）。
//  - 哪些类型用哪些贴图由 data-driven JSON 定义（client.jar 内 assets/minecraft/particles/*.json
//    的 "textures" 数组，如 end_rod → glitter_0..7）；无 JSON 的类型由客户端字节码
//    硬编码 SpriteSet（block/dust/item 等按方块纹理实时取，本脚本不覆盖，渲染层回退软圆点）。
//  - 因此本脚本同时读取「贴图」与「JSON 类型表」，产物是 **类型名 → 帧文件列表** 的完整映射，
//    与 MC 客户端加载语义一致（同纹理列表、同帧序）。
//
// 用法：
//  - 本地/CI 构建前：npm run assets
//    优先用本地 client.jar（MC 安装目录，默认 %APPDATA%/.minecraft/versions/26.2/26.2.jar，
//    可用 MC_JAR 环境变量或第一个命令行参数覆盖）；否则从官方镜像下载并校验 sha1。
//  - 产物（public/particles/ + 映射 ts）提交进仓库 → 日常构建零网络依赖，
//    渲染层发现映射缺失的类型自动回退软圆点。
//
// 版本与 sha1 来自 piston-meta 版本清单（2026-09 抓取）：
//   https://piston-meta.mojang.com/mc/game/version_manifest_v2.json → 26.2
//   downloads.client.url / sha1
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '26.2';
const CLIENT_SHA1 = '2dc72797acbc1b63fc16a11c4ac393605f453754';
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const OUT_DIR = 'public/particles';
const OUT_TS = 'src/render/particleTextures.ts';
const TMP_DIR = join(dirname(fileURLToPath(import.meta.url)), '.mc_extract');

/** 本地 MC 安装里 26.2 client.jar 的默认位置 */
function defaultLocalJar() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(base, '.minecraft', 'versions', VERSION, `${VERSION}.jar`);
  }
  // Linux/macOS: ~/.minecraft/versions/26.2/26.2.jar
  return join(homedir(), '.minecraft', 'versions', VERSION, `${VERSION}.jar`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return await res.json();
}

function sha1OfFile(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

/** 解 jar（zip）到 outDir：优先 PowerShell System.IO.Compression（Windows，支持全部标准压缩）；
 *  失败回退 python3 zipfile。 */
function unzipJar(jarPath, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const win = (p) => p.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    const pw =
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${win(jarPath)}', '${win(outDir)}')`;
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', pw], { stdio: 'pipe' });
      return;
    } catch {
      // 回退 python3
      execFileSync('python3', ['-c',
        'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
        jarPath, outDir], { stdio: 'pipe' });
      return;
    }
  }
  // POSIX：unzip
  execFileSync('unzip', ['-q', '-o', jarPath, '-d', outDir], { stdio: 'pipe' });
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, OUT_DIR);
  const outTs = join(root, OUT_TS);

  // 1. 定位 client.jar：MC_JAR 环境变量 > 命令行参数 > 本地 MC 安装 > 官方镜像下载
  let jarPath = process.env.MC_JAR ?? process.argv[2] ?? '';
  if (jarPath && !existsSync(jarPath)) throw new Error(`指定的 client.jar 不存在：${jarPath}`);
  if (!jarPath && existsSync(defaultLocalJar())) {
    jarPath = defaultLocalJar();
    console.log(`[assets] 使用本地 MC client.jar：${jarPath}`);
  }
  const extracted = join(TMP_DIR, 'jar');
  if (!jarPath) {
    const list = await fetchJson(MANIFEST_URL);
    const entry = (list.versions ?? []).find((v) => v.id === VERSION);
    if (!entry) throw new Error(`版本清单里没有 ${VERSION}`);
    const manifest = await fetchJson(entry.url);
    const dl = manifest.downloads.client;
    if (dl.sha1 !== CLIENT_SHA1) {
      throw new Error(`26.2 client jar sha1 漂移（清单 ${dl.sha1} ≠ 常量 ${CLIENT_SHA1}）：升级本脚本常量后再跑`);
    }
    console.log(`[assets] 本地无 jar，从官方镜像下载 ${VERSION} client.jar`);
    jarPath = join(TMP_DIR, 'client.jar');
    const res = await fetch(dl.url);
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${dl.url}`);
    writeFileSync(jarPath, Buffer.from(await res.arrayBuffer()));
  }
  if (sha1OfFile(jarPath) !== CLIENT_SHA1) throw new Error('jar sha1 校验失败，需要 26.2 客户端 jar');
  console.log(`[assets] sha1 校验通过（${CLIENT_SHA1}）`);

  // 2. 解 jar
  unzipJar(jarPath, extracted);
  const texDir = join(extracted, 'assets', 'minecraft', 'textures', 'particle');
  const jsonDir = join(extracted, 'assets', 'minecraft', 'particles');
  if (!existsSync(texDir)) throw new Error('jar 内无 textures/particle/（版本不符？）');

  // 3. 收集全部粒子贴图文件（帧存在性校验用）
  const texFiles = new Set(readdirSync(texDir).filter((f) => f.endsWith('.png')));
  if (texFiles.size < 100) throw new Error(`粒子贴图仅 ${texFiles.size} 张，疑似 jar 版本不符`);

  // 4. 读取 data-driven 类型表（assets/minecraft/particles/*.json → "textures" 数组）
  const map = new Map();
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
      if (frames.length) map.set(type, frames);
    }
  }
  console.log(`[assets] data-driven 类型 ${map.size} 个（JSON "textures" 表）`);

  // 5. 校验帧文件存在（缺帧 = MC 客户端会 warn "Missing particle sprites"）
  const missing = [];
  for (const [type, frames] of map) {
    for (const f of frames) if (!texFiles.has(`${f}.png`)) missing.push(`${type}→${f}`);
  }
  if (missing.length) throw new Error(`帧文件缺失 ${missing.length} 个（前 8）：${missing.slice(0, 8).join(', ')}`);

  // 6. 铺平贴图到 public/particles/（只铺被类型表引用的文件，控制体积）
  const used = new Set();
  for (const frames of map.values()) for (const f of frames) used.add(`${f}.png`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of used) copyFileSync(join(texDir, f), join(outDir, f));
  console.log(`[assets] 写出 ${used.size} 张贴图 → ${OUT_DIR}/`);

  // 7. 生成 TS 映射（类型名 → 帧列表）。
  //    未收录类型（block/dust/item 等按方块纹理实时渲染的类型、未知名）→ undefined，
  //    渲染层回退软圆点。
  const rows = [];
  for (const [type, frames] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(`  ${JSON.stringify(type)}: [${frames.map((f) => JSON.stringify(f)).join(', ')}],`);
  }
  const header = `// 由 scripts/gen-particle-assets.mjs 生成（Minecraft ${VERSION} 客户端，sha1 ${CLIENT_SHA1.slice(0, 8)}…）。
// 类型名 → 帧贴图列表（public/particles/<帧>.png，帧序与 MC 客户端一致，
// 帧动画时长按 MC 客户端惯例 1/20 s/帧）。
// 未收录类型（block/dust/item 等按方块纹理实时渲染的类型、未知名）→ undefined，渲染层回退软圆点。
export const PARTICLE_TEXTURES: Record<string, string[]> = {
${rows.join('\n')}
};
`;
  writeFileSync(outTs, header);
  console.log(`[assets] 生成 ${OUT_TS}（${map.size} 类型）`);

  rmSync(TMP_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`[assets] 失败：${e.message}`);
  process.exit(1);
});
