/**
 * 通用文件下载续传的纯逻辑内核 —— 不依赖 Electron，可被 node --test 覆盖。
 *
 * 方案参考 fnos-desktop 的 DownloadManager：
 *   - 断点续传用 HTTP `Range: bytes=<已有字节>-`，仅在服务端支持分段（Accept-Ranges）
 *     且已有 .part 时续传，否则整段重来；
 *   - 跨会话/分区去重：以「文件名 + 总大小 + URL 末段路径」为指纹，短窗口内相同指纹只处理一次；
 *   - 速度/ETA 基于本地已收字节与时间窗口差分计算，不依赖服务端返回。
 * 真正的 will-download / fs 落盘 / DownloadItem 生命周期由主进程接线调用这些函数。
 */

/** 续传决策输入。 */
export interface ResumeInput {
    /** 目标已存在的 .part 字节数（无则 0）。 */
    existingBytes: number;
    /** 服务端 Content-Length 报告的总大小；未知传 null。 */
    totalBytes: number | null;
    /** 服务端是否支持分段（Accept-Ranges: bytes）。 */
    serverAcceptsRanges: boolean;
}

export type ResumeMode = 'restart' | 'resume' | 'complete';

/** 续传决策结果。 */
export interface ResumePlan {
    mode: ResumeMode;
    /** 续传起始字节（restart 为 0；resume 为 existingBytes）。 */
    startByte: number;
    /** 要发往服务端的 Range 头；restart/complete 为 undefined。 */
    rangeHeader?: string;
}

/**
 * 决定一次下载是"重来 / 续传 / 已完成"。
 * 边界：已有字节 ≥ 总大小 → complete；无 ranges 支持或已有字节 ≤0 → restart。
 */
export function planResume(input: ResumeInput): ResumePlan {
    const existing = Math.max(0, Math.floor(input.existingBytes || 0));
    const total = typeof input.totalBytes === 'number' && input.totalBytes >= 0 ? input.totalBytes : null;

    if (total !== null && total > 0 && existing >= total) {
        return { mode: 'complete', startByte: existing };
    }
    if (existing > 0 && input.serverAcceptsRanges) {
        return { mode: 'resume', startByte: existing, rangeHeader: `bytes=${existing}-` };
    }
    return { mode: 'restart', startByte: 0 };
}

/**
 * 下载去重指纹（跨会话稳定）：文件名 + 总大小 + URL 路径末段。
 * totalBytes 未知时用 'x' 占位，保证同参数得到同串。
 */
export function dedupeFingerprint(parts: {
    fileName: string;
    totalBytes: number | null;
    url: string;
}): string {
    let tail = '';
    try {
        const path = new URL(parts.url).pathname;
        const segs = path.split('/').filter(Boolean);
        tail = segs.length ? segs[segs.length - 1] : '';
    } catch {
        tail = '';
    }
    const size = typeof parts.totalBytes === 'number' && parts.totalBytes >= 0 ? String(parts.totalBytes) : 'x';
    return `${parts.fileName}::${size}::${tail}`;
}

/** 净化为 Windows 安全的单文件名：去目录、替换非法字符与控制符、防保留名、限长。 */
export function sanitizeFileName(raw: string): string {
    let name = (raw || '').trim();
    // 去掉任何路径成分（\ 或 /），只留末段
    name = name.replace(/^.*[\\/]/, '');
    // 非法字符 \ / : * ? " < > | 与控制符 0x00-0x1F → 下划线
    name = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
    // 首尾的空格与点 Windows 不允许
    name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    // 保留设备名（不区分大小写）→ 前缀下划线
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.split('.')[0])) {
        name = '_' + name;
    }
    if (!name) name = 'download';
    // 限长，避免超长路径
    if (name.length > 200) {
        const dot = name.lastIndexOf('.');
        if (dot > 0 && name.length - dot <= 12) {
            name = name.slice(0, 200 - (name.length - dot)) + name.slice(dot);
        } else {
            name = name.slice(0, 200);
        }
    }
    return name;
}

/** 由"已收字节增量 / 耗时"算速度（bytes/sec）。耗时 ≤0 或非正增量返回 0。 */
export function computeSpeed(receivedBytesDelta: number, elapsedMs: number): number {
    if (!(elapsedMs > 0) || !(receivedBytesDelta > 0)) return 0;
    return (receivedBytesDelta / elapsedMs) * 1000;
}

/** 预估剩余秒数；速度为 0 或总大小未知返回 null。 */
export function computeEta(params: {
    totalBytes: number | null;
    receivedBytes: number;
    bytesPerSecond: number;
}): number | null {
    const { totalBytes, receivedBytes, bytesPerSecond } = params;
    if (typeof totalBytes !== 'number' || totalBytes < 0) return null;
    if (!(bytesPerSecond > 0)) return null;
    const remaining = totalBytes - receivedBytes;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / bytesPerSecond);
}
