import * as crypto from 'crypto';
import * as log from '../../modules/logger';

/**
 * fnOS 管理端 WebSocket RPC 登录客户端（自建二次验证流程用）。
 * 协议对齐飞牛 web 端（逆向自官方前端 bundle，实测握手与 user.login 加密链路通过）：
 * - 端点: ws(s)://<host>/websocket?type=main
 * - 握手: 明文 {reqid, req:'util.crypto.getRSAPub'} → {pub, si}
 * - 加密业务: 信封 {req:'encrypted', iv, rsa, aes}，
 *   aes = AES-256-CBC(JSON.stringify({reqid, si, req:'user.login', ...顶层参数}))，
 *   rsa = RSA-PKCS1(aesKey)，key/iv 为 base64
 * - 2FA 链: user.login →(data.accessToken)→ appcgi.tfa.security.v1.login.totpVerify{data}
 *   → user.2fa.loginVerify → {ticket, token, longToken, secret, uid}
 */

const WS_PATH = '/websocket?type=main';
const REQ_RSA_PUB = 'util.crypto.getRSAPub';
const ERR_BAD_PASSWORD = 131072;
const ERR_IP_BANNED = 131089;

export interface Fn2faLoginResult {
    kind: 'ok' | '2fa' | 'error';
    message?: string;
    token?: string;
    longToken?: string;
    secret?: string;
    uid?: string;
    accessToken?: string;
}

export interface Fn2faSession {
    socket: FnWsClient;
    server: string;
    username: string;
    stay: boolean;
    accessToken: string;
    createdAt: number;
}

function toPem(pub: string): string {
    const body = pub.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) || [];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function b64(buf: Buffer): string {
    return buf.toString('base64');
}

class FnWsClient {
    private ws: WebSocket | null = null;
    private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private seq = 0;
    private iv = crypto.randomBytes(16);
    aesKey = '';
    rsaB64 = '';
    si = '';

    genReqId(): string {
        return `${Date.now()}${++this.seq}`;
    }

    connect(server: string): Promise<void> {
        const url = server.replace(/^http/, 'ws') + WS_PATH;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws = ws;
            const timer = setTimeout(() => reject(new Error('连接登录服务超时')), 10000);
            ws.onopen = () => { clearTimeout(timer); resolve(); };
            ws.onerror = () => { clearTimeout(timer); reject(new Error('无法连接登录服务')); };
            ws.onmessage = (event) => this.onMessage(String(event.data));
            ws.onclose = () => this.rejectAll(new Error('登录连接已关闭'));
        });
    }

    private rejectAll(err: Error): void {
        this.pending.forEach(({ reject }) => reject(err));
        this.pending.clear();
    }

    private onMessage(raw: string): void {
        let msg: any;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg?.req === 'pong' || msg?.res === 'pong') return;
        const reqid = msg?.reqid;
        if (reqid && this.pending.has(reqid)) {
            const entry = this.pending.get(reqid)!;
            this.pending.delete(reqid);
            entry.resolve(msg);
        }
    }

    private sendRequest(registerReqid: string, body: string, timeoutMs = 15000): Promise<any> {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('登录连接未就绪'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.delete(registerReqid)) reject(new Error('登录服务响应超时'));
            }, timeoutMs);
            this.pending.set(registerReqid, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
            ws.send(body);
        });
    }

    /** 明文请求：reqid 在外层信封上 */
    private request(payload: Record<string, unknown>): Promise<any> {
        const reqid = String((payload as { reqid?: unknown }).reqid || this.genReqId());
        return this.sendRequest(reqid, JSON.stringify(Object.assign({ reqid }, payload)));
    }

    async handshake(): Promise<void> {
        const resp = await this.request({ req: REQ_RSA_PUB });
        const pub = resp?.pub || resp?.data?.pub;
        this.si = resp?.si ?? resp?.data?.si ?? '';
        if (!pub) throw new Error('获取服务器公钥失败');
        this.aesKey = crypto.randomBytes(24).toString('base64'); // 32 字符 ASCII 密钥
        this.rsaB64 = b64(crypto.publicEncrypt(
            { key: toPem(pub), padding: crypto.constants.RSA_PKCS1_PADDING },
            Buffer.from(this.aesKey, 'utf8'),
        ));
    }

    /** 加密信封请求：reqid/si 只在 AES 明文里，外层信封无 reqid（服务端按明文 reqid 应答） */
    rpcEncrypted(params: Record<string, unknown>): Promise<any> {
        const reqid = this.genReqId();
        const plain = JSON.stringify(Object.assign({ reqid, si: this.si }, params));
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.aesKey, 'utf8'), this.iv);
        const aes = b64(Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]));
        return this.sendRequest(reqid, JSON.stringify({ req: 'encrypted', iv: b64(this.iv), rsa: this.rsaB64, aes }));
    }

    close(): void {
        try { this.ws?.close(); } catch { /* 忽略 */ }
        this.ws = null;
    }
}

function describeErrno(errno: number): string {
    if (errno === ERR_BAD_PASSWORD) return '用户名或密码错误';
    if (errno === ERR_IP_BANNED) return '当前 IP 已被临时封禁，请稍后再试';
    return `登录失败（错误码 ${errno}）`;
}

interface LoginData {
    user: string;
    password: string;
    stay: number;
    deviceType: string;
    deviceName: string;
    did: string;
}

function buildLoginParams(server: { username: string; password: string; stay: boolean }): Record<string, unknown> {
    const data: LoginData = {
        user: server.username,
        password: server.password,
        stay: server.stay ? 2 : 0,
        deviceType: 'desktop',
        deviceName: 'fnOS-Desktop',
        did: `electron-${Date.now()}`,
    };
    return { req: 'user.login', ...data };
}

async function openConnectedClient(server: string): Promise<FnWsClient> {
    const client = new FnWsClient();
    await client.connect(server);
    await client.handshake();
    return client;
}

/**
 * 第一步：提交账号密码。
 * 响应字段在顶层（无 data 包装）。返回 kind='ok'（无需 2FA）或 kind='2fa'（需动态码）。
 * 判定对齐 web 端：!isTwofaEnforced && !isBindTwofaSecret，或已绑定且受信任设备 → 直接完成。
 */
export async function fnLoginStart(
    server: string,
    username: string,
    password: string,
    stay: boolean,
): Promise<{ kind: 'ok'; result: Fn2faLoginResult; client: FnWsClient } | { kind: '2fa'; session: Fn2faSession } | { kind: 'error'; message: string }> {
    const client = await openConnectedClient(server);
    try {
        const resp = await client.rpcEncrypted(buildLoginParams({ username, password, stay }));
        if (resp?.result === 'fail' || (typeof resp?.errno === 'number' && resp.errno !== 0)) {
            const message = resp?.errmsg || describeErrno(Number(resp.errno) || -1);
            client.close();
            return { kind: 'error', message };
        }
        const skip2fa = (!resp.isTwofaEnforced && !resp.isBindTwofaSecret)
            || (resp.isBindTwofaSecret && resp.isTrustedDevice);
        if (!skip2fa && resp.accessToken) {
            return {
                kind: '2fa',
                session: { socket: client, server, username, stay, accessToken: String(resp.accessToken), createdAt: Date.now() },
            };
        }
        if (resp.token) {
            return {
                kind: 'ok',
                client,
                result: { kind: 'ok', token: resp.token, longToken: resp.longToken, secret: resp.secret, uid: resp.uid },
            };
        }
        client.close();
        return { kind: 'error', message: `登录响应格式异常（result=${String(resp?.result)}），请改用"前往原生登录"` };
    } catch (error) {
        client.close();
        throw error;
    }
}

/**
 * 第二步：提交 6 位动态码。对齐 web 端：直接走 user.2fa.loginVerify（加密通道），
 * 成功返回 {ticket, token, longToken, secret, machineId, uid}。
 */
export async function fnLoginTotp(session: Fn2faSession, code: string): Promise<Fn2faLoginResult> {
    const verify = await session.socket.rpcEncrypted({
        req: 'user.2fa.loginVerify',
        code,
        isTrustedDevice: false,
        accessToken: session.accessToken,
        stay: session.stay ? 2 : 0,
        deviceType: 'desktop',
        deviceName: 'fnOS-Desktop',
        did: `electron-${Date.now()}`,
    });
    if (verify?.result === 'fail' || (typeof verify?.errno === 'number' && verify.errno !== 0)) {
        const errno = Number(verify.errno);
        return { kind: 'error', message: errno === 135168 ? '验证码错误，请重新输入' : (verify?.errmsg || `动态码验证失败（错误码 ${errno || -1}）`) };
    }
    if (!verify?.token) {
        log.warn('[2FA] loginVerify 无 token:', JSON.stringify(verify).slice(0, 200));
        return { kind: 'error', message: '登录确认响应缺少 token，请改用"前往原生登录"' };
    }
    return { kind: 'ok', token: verify.token, longToken: verify.longToken, secret: verify.secret, uid: verify.uid };
}

export function closeFn2faSession(session: Fn2faSession | null | undefined): void {
    try { session?.socket.close(); } catch { /* 忽略 */ }
}
