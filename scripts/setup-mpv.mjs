#!/usr/bin/env node
/**
 * mpv 运行环境自动装配脚本。
 *
 * 背景：third_party/* 被 .gitignore 排除，mpv.exe + 依赖 DLL + portable_config 不进仓库，
 * 干净克隆后 third_party/fntv-mpv 为空 → 点播放会报 "mpv.exe 找不到"、播放无效。
 * 本脚本把 mpv 装配到 third_party/fntv-mpv/（基座解析的可执行路径）。
 *
 * 用法：
 *   node scripts/setup-mpv.mjs --auto                 自动在本机常见位置找现成 mpv 并复制
 *   node scripts/setup-mpv.mjs --from "D:\\path\\to\\mpv"   从指定目录复制（含 mpv.exe + *.dll [+ portable_config]）
 *   node scripts/setup-mpv.mjs --url "https://.../mpv.zip"  下载 zip 并解压（Windows 11 自带 tar 支持 zip）
 *   可选：--target <dir>  自定义目标（默认 <仓库>/third_party/fntv-mpv）；--force 覆盖已存在的 mpv.exe
 *
 * 退出码：0 成功；非 0 失败（供 npm script / CI 感知）。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const args = { auto: false, force: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--auto') args.auto = true;
        else if (a === '--force') args.force = true;
        else if (a === '--from') args.from = argv[++i];
        else if (a === '--url') args.url = argv[++i];
        else if (a === '--target') args.target = argv[++i];
        else { console.error(`未知参数: ${a}`); process.exit(2); }
    }
    return args;
}

function log(msg) { console.log(`[setup-mpv] ${msg}`); }

/** 本机可能已有 mpv 的位置（复用现成的，避免下载）。 */
function candidateMpvDirs() {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const list = [
        process.env.FNOS_MPV_DIR,
        path.join(local, 'fnOS Desktop', 'mpv'),
        path.join(local, 'fnos-desktop', 'mpv'),
        path.join(local, 'Programs', 'mpv'),
    ].filter(Boolean);
    // PATH 上的 mpv.exe
    const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mpv'], { encoding: 'utf8' });
    if (where.status === 0) {
        for (const line of where.stdout.split(/\r?\n/)) {
            if (line.trim()) list.push(path.dirname(line.trim()));
        }
    }
    return list;
}

function hasMpv(dir) {
    return dir && fs.existsSync(path.join(dir, 'mpv.exe'));
}

/** 从源目录复制 mpv.exe + *.dll +（可选）portable_config 到目标。 */
function copyFrom(srcDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const entries = fs.readdirSync(srcDir);
    let copied = 0;
    for (const name of entries) {
        if (/^mpv\.exe$/i.test(name) || /\.dll$/i.test(name)) {
            fs.copyFileSync(path.join(srcDir, name), path.join(targetDir, name));
            copied++;
        }
    }
    // portable_config（uosc / 弹幕 / 着色器）若源里有则一并带上
    const srcCfg = path.join(srcDir, 'portable_config');
    const dstCfg = path.join(targetDir, 'portable_config');
    let cfgCopied = false;
    if (fs.existsSync(srcCfg) && !fs.existsSync(dstCfg)) {
        fs.cpSync(srcCfg, dstCfg, { recursive: true });
        cfgCopied = true;
    }
    return { copied, cfgCopied };
}

function download(url, destFile) {
    return new Promise((resolve, reject) => {
        const get = (u, depth) => {
            if (depth > 5) return reject(new Error('重定向次数过多'));
            https.get(u, { headers: { 'User-Agent': 'fnos-desktop-new-setup' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return get(new URL(res.headers.location, u).toString(), depth + 1);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
                const out = fs.createWriteStream(destFile);
                res.pipe(out);
                out.on('finish', () => out.close(() => resolve(destFile)));
                out.on('error', reject);
            }).on('error', reject);
        };
        get(url, 0);
    });
}

/** 用 Windows 11 自带 tar 解压 zip 到目标（mpv 官方是 7z，此处仅支持 zip 构建）。 */
function extractZip(zipFile, targetDir) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv-'));
    const r = spawnSync('tar', ['-xf', zipFile, '-C', tmp], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('tar 解压失败（仅支持 zip；mpv 官方 7z 请手动或用 --from）');
    // 解压后 mpv.exe 可能在子目录里，找到它所在目录再复制
    let found = null;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/^mpv\.exe$/i.test(e.name) && !found) found = d;
        }
    };
    walk(tmp);
    if (!found) throw new Error('压缩包内未找到 mpv.exe');
    return copyFrom(found, targetDir);
}

function verifyMpv(targetDir) {
    const exe = path.join(targetDir, 'mpv.exe');
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    const firstLine = (r.stdout || '').split(/\r?\n/)[0] || '';
    return { ok: r.status === 0 && /mpv/i.test(firstLine), firstLine };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(args.target || path.join(repoRoot, 'third_party', 'fntv-mpv'));

    if (hasMpv(target) && !args.force) {
        const v = verifyMpv(target);
        log(`目标已存在 mpv.exe，跳过（--force 可覆盖）。${v.ok ? '校验通过：' + v.firstLine : '⚠ 校验未通过'}`);
        process.exit(v.ok ? 0 : 1);
    }

    let srcDir = null;
    if (args.from) {
        if (!hasMpv(args.from)) { console.error(`[setup-mpv] --from 目录内没有 mpv.exe: ${args.from}`); process.exit(1); }
        srcDir = path.resolve(args.from);
    } else if (args.url) {
        log(`下载: ${args.url}`);
        const zip = path.join(os.tmpdir(), `mpv-${Date.now()}.zip`);
        await download(args.url, zip);
        const res = extractZip(zip, target);
        fs.rmSync(zip, { force: true });
        log(`下载解压完成：复制 ${res.copied} 个文件，portable_config=${res.cfgCopied}`);
    } else if (args.auto) {
        srcDir = candidateMpvDirs().find(hasMpv) || null;
        if (!srcDir) {
            console.error('[setup-mpv] 本机未找到现成 mpv。请用 --from <mpv目录> 或 --url <zip>，或安装 fnOS Desktop 后重试。');
            process.exit(1);
        }
    } else {
        console.error('[setup-mpv] 缺少参数：--auto | --from <dir> | --url <zip>（可选 --target/--force）');
        process.exit(2);
    }

    if (srcDir) {
        log(`从现成 mpv 复制: ${srcDir}`);
        const res = copyFrom(srcDir, target);
        log(`复制 ${res.copied} 个文件（mpv.exe + DLL），portable_config=${res.cfgCopied}`);
    }

    const v = verifyMpv(target);
    if (!v.ok) { console.error(`[setup-mpv] 校验失败：${target}\\mpv.exe 无法运行`); process.exit(1); }
    log(`完成 ✅  ${v.firstLine}`);
    log(`目标目录: ${target}`);
}

main().catch((e) => { console.error('[setup-mpv] 出错:', e?.message || e); process.exit(1); });
