/**
 * 多服务器注册表 —— 纯逻辑，不依赖 Electron / 磁盘，可被 node --test 覆盖。
 *
 * 职责：记录"已知服务器集合 + 当前活动服务器"，作为多服务器登录态隔离的大脑
 * （配合 src/main/common/partition.ts：活动服务器的 domain → 其专属分区）。
 * 持久化（写 config.json）与真机切换（重建主窗 / restoreCookies）由上层负责，
 * 这里只做状态演算，且所有函数返回新对象、不改入参（不可变，便于测试与回放）。
 */

/** 一台已知服务器。domain 为规范化后的 origin，作唯一键。 */
export interface ServerRecord {
    domain: string;
    account?: string;
    useHttps?: boolean;
    addedAt: number;
}

export interface ServerRegistry {
    servers: ServerRecord[];
    activeDomain: string | null;
}

/** 待写入的服务器入参（未规范化、无 addedAt）。 */
export interface ServerInput {
    domain: string;
    account?: string;
    useHttps?: boolean;
}

const MAX_SERVERS = 32;

/**
 * 规范化服务器键：去首尾空白与末尾斜杠；host[:port] 段小写；无 scheme 时默认 https。
 * scheme 参与键值，故 http 与 https 视为不同端点（各自独立分区）。
 */
export function normalizeDomain(domain: string): string {
    const d = (domain || '').trim();
    if (!d) return '';
    const m = d.match(/^(https?:\/\/)?([^/?#]+)(.*)$/i);
    if (!m) return d.toLowerCase().replace(/\/+$/, '');
    const scheme = (m[1] || 'https://').toLowerCase();
    const host = m[2].toLowerCase();
    const path = (m[3] || '').replace(/\/+$/, '');
    return `${scheme}${host}${path}`;
}

export function emptyRegistry(): ServerRegistry {
    return { servers: [], activeDomain: null };
}

/**
 * 新增或更新一台服务器（按规范化 domain 去重）。
 * - 已存在 → 合并 account/useHttps（传入 undefined 时保留旧值），不改变排序。
 * - 不存在 → 追加；超过 MAX_SERVERS 时淘汰"最旧且非活动"的一台。
 * - 若当前无活动服务器，则把本次这台设为活动。
 */
export function upsertServer(
    reg: ServerRegistry,
    input: ServerInput,
    now: number = Date.now(),
): ServerRegistry {
    const key = normalizeDomain(input.domain);
    if (!key) return reg;

    const servers = reg.servers.slice();
    const idx = servers.findIndex(s => s.domain === key);
    if (idx >= 0) {
        servers[idx] = {
            ...servers[idx],
            account: input.account !== undefined ? input.account : servers[idx].account,
            useHttps: input.useHttps !== undefined ? input.useHttps : servers[idx].useHttps,
        };
    } else {
        servers.push({ domain: key, account: input.account, useHttps: input.useHttps, addedAt: now });
    }

    let activeDomain = reg.activeDomain;
    if (servers.length > MAX_SERVERS) {
        const victimIdx = servers.findIndex(s => s.domain !== activeDomain);
        if (victimIdx >= 0) servers.splice(victimIdx, 1);
    }
    if (!activeDomain) activeDomain = key;

    return { servers, activeDomain };
}

/** 删除一台服务器；若删的是活动项，则回退到剩余的第一台（都没有则 null）。 */
export function removeServer(reg: ServerRegistry, domain: string): ServerRegistry {
    const key = normalizeDomain(domain);
    const servers = reg.servers.filter(s => s.domain !== key);
    if (servers.length === reg.servers.length) return reg; // 未命中，原样返回
    let activeDomain = reg.activeDomain;
    if (activeDomain === key) {
        activeDomain = servers.length ? servers[0].domain : null;
    }
    return { servers, activeDomain };
}

/** 设为活动；domain 不存在则不改（原样返回）。 */
export function setActiveServer(reg: ServerRegistry, domain: string): ServerRegistry {
    const key = normalizeDomain(domain);
    if (!reg.servers.some(s => s.domain === key)) return reg;
    return { servers: reg.servers.slice(), activeDomain: key };
}

/** 取当前活动服务器记录（无则 null）。 */
export function getActiveServer(reg: ServerRegistry): ServerRecord | null {
    if (!reg.activeDomain) return null;
    return reg.servers.find(s => s.domain === reg.activeDomain) || null;
}

/** 列出所有服务器（返回副本，防外部改动内部数组）。 */
export function listServers(reg: ServerRegistry): ServerRecord[] {
    return reg.servers.slice();
}

/** 从可能是 undefined/半成品的持久化数据规范化成合法注册表（迁移容错）。 */
export function coerceRegistry(raw?: Partial<ServerRegistry> | null): ServerRegistry {
    const servers: ServerRecord[] = [];
    const seen = new Set<string>();
    for (const s of raw?.servers || []) {
        const key = normalizeDomain(s?.domain || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        servers.push({
            domain: key,
            account: s.account,
            useHttps: s.useHttps,
            addedAt: typeof s.addedAt === 'number' ? s.addedAt : 0,
        });
    }
    let activeDomain = normalizeDomain(raw?.activeDomain || '');
    if (!activeDomain || !seen.has(activeDomain)) {
        activeDomain = servers.length ? servers[0].domain : '';
    }
    return { servers, activeDomain: activeDomain || null };
}
