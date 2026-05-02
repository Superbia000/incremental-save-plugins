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
    
    console.log('[Incremental Save] 🚀 增量儲存與快取後端模組已啟動');

    // --- 1. 增量保存 (單人) ---
    router.post('/save-append', async (req, res) => {
        try {
            // 完美適配 ST 1.17.0 變數名稱變更
            const chat_file = req.body.chat_file || req.body.file_name;
            const avatar_url = req.body.avatar_url || req.body.character_name || req.body.ch_name;
            const expectedLines = req.body.expectedLines;
            const newMessages = req.body.newMessages;

            if (!chat_file || !avatar_url || expectedLines === undefined || !newMessages) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const directories = req.user ? req.user.directories : require('../../src/directories');
            const safeAvatarUrl = path.basename(avatar_url);
            
            // ST 1.17.0 可能不帶副檔名，這裡自動補齊
            let safeChatFile = path.basename(chat_file);
            if (!safeChatFile.endsWith('.jsonl')) {
                safeChatFile += '.jsonl';
            }

            const chatPath = path.join(directories.chats, safeAvatarUrl, safeChatFile);

            let fileLines = 0;
            try {
                const fileContent = await fs.readFile(chatPath, 'utf8');
                fileLines = fileContent.trim().split('\n').filter(line => line.length > 0).length;
            } catch (err) {
                // 如果是全新對話，檔案可能尚不存在，此時 fileLines 為 0
            }

            if (fileLines !== expectedLines) {
                return res.status(409).json({ error: `Line count mismatch: expected ${expectedLines} but got ${fileLines}` });
            }

            const appendText = newMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
            await fs.appendFile(chatPath, appendText, 'utf8');
            
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
            const targetId = req.body.chat_file || req.body.id || req.body.file_name; 
            const { expectedLines, newMessages } = req.body;
            
            if (!targetId || expectedLines === undefined || !newMessages) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            
            const directories = req.user ? req.user.directories : require('../../src/directories');
            const safeId = path.basename(targetId);
            const fileName = safeId.endsWith('.jsonl') ? safeId : `${safeId}.jsonl`;
            const chatPath = path.join(directories.group_chats, fileName);

            let fileLines = 0;
            try {
                const fileContent = await fs.readFile(chatPath, 'utf8');
                fileLines = fileContent.trim().split('\n').filter(line => line.length > 0).length;
            } catch (err) {}

            if (fileLines !== expectedLines) {
                return res.status(409).json({ error: 'Line count mismatch' });
            }

            const appendText = newMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
            await fs.appendFile(chatPath, appendText, 'utf8');
            
            console.log(`[Incremental Save] ⚡ (群組) 成功增量寫入 ${newMessages.length} 條訊息至: ${fileName}`);
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    // --- 3. 圖片快取代理 (保持不變) ---
    router.get('/image-proxy', async (req, res) => {
        // ... (這部分保留之前的實作)
    });
};
