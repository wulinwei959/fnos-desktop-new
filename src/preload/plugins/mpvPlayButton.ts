/**
 * 在影视页（/v）的原生播放按钮旁，注入一个独立的"用 MPV 播放"按钮。
 * 合并版策略：默认走飞牛原生播放；MPV 改为此按钮按需选择（不再全局劫持播放键）。
 * 复用基座已验证的播放按钮识别与取流逻辑（findSemanticPlayButton / findItemGuid / sendPlayEvent）。
 */
import {
    findSemanticPlayButton,
    findItemGuid,
    getSelectedSourceIndex,
    sendPlayEvent,
} from '../core/playback';
import { extractItemGuidFromUrl } from '../core/playTarget';

const BTN_MARK = 'mpvPlayBtnAdded';

function onMediaPage(): boolean {
    return /^\/v(\/|$)/.test(location.pathname);
}

function styleButton(btn: HTMLElement): void {
    btn.setAttribute(
        'style',
        'margin-left:10px;padding:0 18px;height:36px;border-radius:18px;border:1px solid rgba(255,255,255,.35);' +
        'background:rgba(37,99,235,.85);color:#fff;font-size:14px;cursor:pointer;display:inline-flex;' +
        'align-items:center;gap:6px;line-height:1;white-space:nowrap;vertical-align:middle;',
    );
}

function injectOne(): void {
    if (!onMediaPage()) return;
    const candidates = document.querySelectorAll<HTMLElement>('button,[role="button"],a');
    for (const el of Array.from(candidates)) {
        if (el.dataset[BTN_MARK] === 'true') continue;
        const playBtn = findSemanticPlayButton(el);
        if (!playBtn) continue;
        if (playBtn.dataset[BTN_MARK] === 'true') continue;

        playBtn.dataset[BTN_MARK] = 'true';

        const mpvBtn = document.createElement('button');
        mpvBtn.type = 'button';
        mpvBtn.textContent = '▶ 用 MPV 播放';
        mpvBtn.dataset.customPlay = 'true'; // 关键：让 findSemanticPlayButton 跳过它，避免被当成播放键重复注入/劫持
        styleButton(mpvBtn);
        mpvBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 详情页优先用 URL 里的 guid（/v/movie/<guid>），避免命中祖先无关 data-id；
            // 非详情页（卡片播放键）再回退到元素/链接推导。
            const itemGuid = extractItemGuidFromUrl(location.href) || findItemGuid(playBtn);
            if (!itemGuid) {
                console.warn('[mpvPlayButton] 未能识别播放项 guid');
                return;
            }
            sendPlayEvent(itemGuid, getSelectedSourceIndex());
        });
        playBtn.insertAdjacentElement('afterend', mpvBtn);
        return; // 每帧最多注入一个，MutationObserver 会持续补齐
    }
}

let scheduled = false;
function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; injectOne(); }, 200);
}

function start(): void {
    injectOne();
    const mo = new MutationObserver(() => schedule());
    mo.observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();
else document.addEventListener('DOMContentLoaded', start);

export {};
