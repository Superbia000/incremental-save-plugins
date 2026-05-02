const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require('express');

module.exports.info = {
    id: 'incremental-save',
    name: 'Incremental Save & Image Cache',
    description: '提供無損增量儲存與外部圖片快取服務'
};

module.exports.init = async function (router) {
    router.use(express.json({ limit: '50mb' }));
    
    // 後端啟動提示
    console.log('[Incremental Save] 🚀 增量儲存與快取後端模組已啟動');

    // --- 1. 增量保存 (單人) ---
    router.post('/save-append', async (req, res) => {
        try {
            const { chat_file, avatar_url, expectedLines, newMessages } = req.body;
            if (!chat_file || !avatar_url || expectedLines === undefined || !newMessages) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const directories = req.user ? req.user.directories : require('../../src/directories');
            const safeAvatarUrl = path.basename(avatar_url);
            const safeChatFile = path.basename(chat_file);
            const chatPath = path.join(directories.chats, safeAvatarUrl, safeChatFile);

            const fileContent = await fs.readFile(chatPath, 'utf8');
            const fileLines = fileContent.trim().split('\n').filter(line => line.length > 0).length;

            if (fileLines !== expectedLines) return res.status(409).json({ error: 'Line count mismatch' });

            const appendText = newMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
            await fs.appendFile(chatPath, appendText, 'utf8');
            
            // 終端機成功提示
            console.log(`[Incremental Save] ⚡ 成功增量寫入 ${newMessages.length} 條訊息至: ${safeChatFile}`);
            return res.json({ success: true });
        } catch (e) {
            console.error('[Incremental Save] ❌ 寫入失敗:', e.message);
            return res.status(500).json({ error: e.message });
        }
    });

    // --- 2. 增量保存 (群組) ---
    router.post('/group/save-append', async (req, res) => {
        try {
            const targetId = req.body.chat_file || req.body.id; 
            const { expectedLines, newMessages } = req.body;
            
            const directories = req.user ? req.user.directories : require('../../src/directories');
            const safeId = path.basename(targetId);
            const fileName = safeId.endsWith('.jsonl') ? safeId : `${safeId}.jsonl`;
            const chatPath = path.join(directories.group_chats, fileName);

            const fileContent = await fs.readFile(chatPath, 'utf8');
            const fileLines = fileContent.trim().split('\n').filter(line => line.length > 0).length;

            if (fileLines !== expectedLines) return res.status(409).json({ error: 'Line count mismatch' });

            const appendText = newMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
            await fs.appendFile(chatPath, appendText, 'utf8');
            
            console.log(`[Incremental Save] ⚡ (群組) 成功增量寫入 ${newMessages.length} 條訊息至: ${fileName}`);
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    // --- 3. 圖片快取代理 ---
    router.get('/image-proxy', async (req, res) => {
        const targetUrl = req.query.url;
        if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
            return res.status(400).send('Invalid URL');
        }

        try {
            const hash = crypto.createHash('sha256').update(targetUrl).digest('hex');
            const directories = req.user ? req.user.directories : require('../../src/directories');
            const cacheDir = path.join(directories.chats, '..', 'cache', 'images');
            await fs.mkdir(cacheDir, { recursive: true });
            const cacheFile = path.join(cacheDir, hash);

            try {
                const stats = await fs.stat(cacheFile);
                if (stats.isFile() && stats.size > 0) {
                    res.setHeader('Cache-Control', 'public, max-age=604800');
                    res.setHeader('X-Image-Cache', 'HIT');
                    return res.sendFile(cacheFile);
                }
            } catch (e) {}

            const client = targetUrl.startsWith('https') ? https : http;
            client.get(targetUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) return res.status(proxyRes.statusCode).send('Failed to fetch');

                res.setHeader('Cache-Control', 'public, max-age=604800');
                res.setHeader('X-Image-Cache', 'MISS');

                const fileStream = fsSync.createWriteStream(cacheFile);
                proxyRes.pipe(fileStream);
                proxyRes.pipe(res);
            }).on('error', () => res.status(500).send('Proxy error'));
        } catch (e) {
            res.status(500).send('Server Error');
        }
    });
};
