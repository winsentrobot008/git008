const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 递归解析 Prompt 文本
function parsePrompt(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
        return data.map(item => parsePrompt(item)).filter(Boolean).join('\n');
    }
    if (typeof data === 'object') {
        if (data.content) return parsePrompt(data.content);
        if (data.text) return parsePrompt(data.text);
        if (data.value) return parsePrompt(data.value);
        if (data.input) return parsePrompt(data.input);
        if (data.messages) return parsePrompt(data.messages);
        if (data.prompt) return parsePrompt(data.prompt);
        return JSON.stringify(data);
    }
    return String(data);
}

app.post(/.*/, async (req, res) => {
    const isStream = req.body.stream !== false;
    const lastPrompt = parsePrompt(req.body);
    console.log(`[ Bridge ] 收到请求 (stream=${isStream}), 解析文本长度: ${lastPrompt.length}`);

    if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (res.flushHeaders) res.flushHeaders();
    } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }

    try {
        const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
        const pages = await browser.pages();
        const page = pages.find(p => p.url().includes('deepseek')) || pages[0];

        console.log('[ Bridge ] 正在重置为新对话，清除历史节点...');
        await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' });

        const selector = 'textarea, div[contenteditable="true"], #chat-input';
        await page.waitForSelector(selector, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 800));

        await page.focus(selector);
        await page.evaluate((text) => {
            const el = document.querySelector('textarea, div[contenteditable="true"], #chat-input');
            if (el) {
                el.focus();
                document.execCommand('insertText', false, text);
            }
        }, lastPrompt);

        await new Promise(r => setTimeout(r, 600));
        await page.keyboard.press('Enter');
        console.log('[ Bridge ] 已提交任务，等待生成...');

        let finalReply = '';
        let lastLength = 0;
        let stableCount = 0;

        for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 1000));

            // 使用标准 SSE 注释行（以冒号开头），客户端解析器会忽略此行，但能维持 TCP 链接不超时
            if (isStream) {
                res.write(': keep-alive\n\n');
            }

            const data = await page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('.ds-markdown'));
                if (nodes.length === 0) return { text: '', isBusy: true };

                const lastNode = nodes[nodes.length - 1];
                let parent = lastNode;
                for (let level = 0; level < 5; level++) {
                    if (parent.parentElement && parent.parentElement !== document.body) {
                        parent = parent.parentElement;
                        if (parent.querySelectorAll('.ds-markdown').length > 1) break;
                    }
                }

                const msgNodes = parent.querySelectorAll('.ds-markdown');
                const textList = Array.from(msgNodes).map(n => n.innerText);
                const fullText = textList.length > 0 ? textList.join('\n\n') : lastNode.innerText;

                const hasStopBtn = !!document.querySelector('.ds-icon-stop, [aria-label="Stop"]');
                const isLoading = !!document.querySelector('.ds-icon-loading, .ds-loading, [class*="loading"]');

                return { text: fullText, isBusy: hasStopBtn || isLoading };
            });

            if (data.text) {
                finalReply = data.text;
                if (data.text.length === lastLength && data.text.length > 0 && !data.isBusy) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }
                lastLength = data.text.length;
            }

            if (stableCount >= 3) {
                console.log('[ Bridge ] 判定成功：回答已完全停止输出！');
                break;
            }
        }

        console.log(`[ Bridge ] 抓取成功！最终完整回复字数: ${finalReply.length}`);

        if (isStream) {
            const respId = "resp_" + Date.now();
            const msgId = "msg_" + Date.now();
            const created = Math.floor(Date.now() / 1000);

            // 1. Chat Completions 规范分片
            res.write(`data: ${JSON.stringify({
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: created,
                model: "deepseek-chat",
                choices: [{ index: 0, delta: { role: "assistant", content: finalReply }, finish_reason: null }]
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: created,
                model: "deepseek-chat",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
            })}\n\n`);

            // 2. CODEX /v1/responses 协议全套事件通知
            res.write(`event: response.created\ndata: ${JSON.stringify({
                type: "response.created",
                response: { id: respId, object: "response", status: "in_progress", model: "deepseek-chat", output: [] }
            })}\n\n`);

            res.write(`event: response.output_item.added\ndata: ${JSON.stringify({
                type: "response.output_item.added",
                response_id: respId,
                output_index: 0,
                item: { id: msgId, type: "message", role: "assistant", status: "in_progress", content: [] }
            })}\n\n`);

            res.write(`event: response.content_part.added\ndata: ${JSON.stringify({
                type: "response.content_part.added",
                response_id: respId,
                item_id: msgId,
                output_index: 0,
                content_index: 0,
                part: { type: "text", text: "" }
            })}\n\n`);

            res.write(`event: response.text.delta\ndata: ${JSON.stringify({
                type: "response.text.delta",
                response_id: respId,
                item_id: msgId,
                output_index: 0,
                content_index: 0,
                delta: finalReply
            })}\n\n`);

            res.write(`event: response.text.done\ndata: ${JSON.stringify({
                type: "response.text.done",
                response_id: respId,
                item_id: msgId,
                output_index: 0,
                content_index: 0,
                text: finalReply
            })}\n\n`);

            res.write(`event: response.completed\ndata: ${JSON.stringify({
                type: "response.completed",
                response: {
                    id: respId,
                    object: "response",
                    status: "completed",
                    model: "deepseek-chat",
                    output: [{
                        id: msgId,
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: [{ type: "text", text: finalReply }]
                    }]
                }
            })}\n\n`);

            res.write(`event: response.done\ndata: ${JSON.stringify({
                type: "response.done",
                response: {
                    id: respId,
                    object: "response",
                    status: "completed",
                    output: [{
                        id: msgId,
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: [{ type: "text", text: finalReply }]
                    }]
                }
            })}\n\n`);

            res.write(`data: [DONE]\n\n`);
            res.end();
        } else {
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
        }

    } catch (error) {
        console.error('[ Bridge 报错 ]:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: { message: error.message } });
        } else {
            res.end();
        }
    }
});

app.listen(3000, () => {
    console.log('🚀 CODEX 兼容版 Bridge 已启动！监听端口: 3000');
});