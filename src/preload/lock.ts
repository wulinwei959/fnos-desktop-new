/**
 * 锁屏窗口专用 preload：以 contextBridge 暴露最小 API 给 resource/lock/lock.js。
 * 与影视/主窗的 preload 分离，锁屏页拿不到任何无关能力（最小权限）。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lockAPI', {
    /** 解锁：主进程校验开机密码，成功则关闭锁屏并恢复主窗 */
    unlock: (password: string): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('lock:unlock', password),
    /** 设置/修改开机密码：change 需带 oldPw，setup 传空 */
    setPassword: (oldPw: string, newPw: string): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('lock:set-password', { oldPw, newPw }),
    /** 老板键：隐藏到后台 */
    hide: (): void => { ipcRenderer.send('lock:hide'); },
});
