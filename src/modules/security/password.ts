/**
 * 启动密码（开机密码）哈希工具 —— 纯 Node 加密逻辑，不依赖 Electron，可被 node --test 覆盖。
 *
 * 方案取自 fnos-desktop：scrypt + 每用户随机盐 + 常量时间比较，明文永不落盘。
 * 落盘与锁屏 UI 由上层（handlers/plugins/lock 等）负责，本模块只管算 / 校验。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const SALT_BYTES = 16;

/** 一份可持久化的密码记录（盐与哈希均为 hex 字符串）。 */
export interface PasswordRecord {
    salt: string;
    hash: string;
}

/** 用给定盐对明文口令做 scrypt 哈希，返回 hex。 */
export function hashPassword(password: string, saltHex: string): string {
    return scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN).toString('hex');
}

/** 生成一条新的密码记录（含随机盐）。 */
export function createPasswordRecord(password: string): PasswordRecord {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    return { salt, hash: hashPassword(password, salt) };
}

/**
 * 校验口令是否匹配给定记录。
 * 先比长度再用 timingSafeEqual，避免不同长度 Buffer 直接比较抛错、并抵御时序侧信道。
 */
export function verifyPassword(password: string, record: PasswordRecord | null | undefined): boolean {
    if (!record || !record.salt || !record.hash || !password) {
        return false;
    }
    const expected = Buffer.from(record.hash, 'hex');
    const actual = Buffer.from(hashPassword(password, record.salt), 'hex');
    if (expected.length !== actual.length) {
        return false;
    }
    return timingSafeEqual(expected, actual);
}
