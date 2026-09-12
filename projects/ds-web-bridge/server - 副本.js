const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

app.post('/v1/chat/completions', async (req, res) => {
    const messages = req.body.messages || [];
    const lastPrompt = messages[messages.length - 1]?.content || '';

    try {
        const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
        const pages = await browser.pages();
        const page = pages.find(p => p.url().includes('deepseek')) || pages[0];

        // 1. 自动重置为新对话
        console.log('[ Bridge ] 正在重置为新对话，清除历史节点...');
        await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' });

        const selector = 'textarea, div[contenteditable="true"], #chat-input';
        await page.waitForSelector(selector, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 800));

        // 2. 注入 Prompt
        await page.focus(selector);
        await page.evaluate((text) => {
            const el = document.querySelector('textarea, div[contenteditable="true"], #chat-input');
            if (el) {
                el.focus();
                document.execCommand('insertText', false, text);
            }
        }, lastPrompt);

        await new Promise(r => setTimeout(r, 600));

        // 3. 点击发送
        await page.keyboard.press('Enter');
        console.log('[ Bridge ] 已提交任务，等待生成...');

        // 4. 防抖轮询：必须满足“文本连续 3 秒无增加”且“生成状态彻底结束”才退出
        let finalReply = '';
        let lastLength = 0;
        let stableCount = 0;

        for (let i = 0; i < 180; i++) { // 最长允许 3 分钟
            await new Promise(r => setTimeout(r, 1000));

            const data = await page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('.ds-markdown'));
                if (nodes.length === 0) return { text: '', isBusy: true };

                // 找到最后一个 markdown 节点所在的整条回答容器
                const lastNode = nodes[nodes.length - 1];
                let parent = lastNode;
                for (let level = 0; level < 5; level++) {
                    if (parent.parentElement && parent.parentElement !== document.body) {
                        parent = parent.parentElement;
                        if (parent.querySelectorAll('.ds-markdown').length > 1) break;
                    }
                }

                // 拼合该消息下的全部段落
                const msgNodes = parent.querySelectorAll('.ds-markdown');
                const textList = Array.from(msgNodes).map(n => n.innerText);
                const fullText = textList.length > 0 ? textList.join('\n\n') : lastNode.innerText;

                // 判定是否繁忙（有 Stop 按钮或 Loading 动画）
                const hasStopBtn = !!document.querySelector('.ds-icon-stop, [aria-label="Stop"]');
                const isLoading = !!document.querySelector('.ds-icon-loading, .ds-loading, [class*="loading"]');

                return {
                    text: fullText,
                    isBusy: hasStopBtn || isLoading
                };
            });

            if (data.text) {
                finalReply = data.text;

                // 防抖逻辑：如果字数没有增加，且页面未处于 Busy 状态，累加稳定计数器
                if (data.text.length === lastLength && data.text.length > 0 && !data.isBusy) {
                    stableCount++;
                } else {
                    stableCount = 0; // 文本仍在增加，重置计数器
                }
                lastLength = data.text.length;
            }

            // 只有当文本连续 3 秒（3 次检测）字数完全没有增长且无动画时，才确认完成
            if (stableCount >= 3) {
                console.log('[ Bridge ] 判定成功：回答已完全停止输出！');
                break;
            }
        }

        console.log(`[ Bridge ] 抓取成功！最终完整回复字数: ${finalReply.length}`);

        res.json({
            id: "chatcmpl-" + Date.now(),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "deepseek-chat",
            choices: [{
                index: 0,
                message: { role: "assistant", content: finalReply },
                finish_reason: "stop"
            }]
        });

    } catch (error) {
        console.error('[ Bridge 报错 ]:', error);
        res.status(500).json({ error: { message: error.message } });
    }
});

app.listen(3000, () => {
    console.log('🚀 CODEX 兼容版 Bridge 已启动！监听端口: 3000');
});