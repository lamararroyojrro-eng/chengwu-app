// Vercel Serverless Function: 反向代理到 HTTP 后端
// 浏览器 --HTTPS--> Vercel --HTTP--> 47.116.181.216:3000
// 这样浏览器侧全是 HTTPS，不会触发 Mixed Content 错误。
//
// Vercel 的文件式路由：api/[...path].js 会接管所有 /api/* 请求。
// 在处理函数里 req.url 仍然是完整的原始路径（例如 /api/jobs/1），
// 所以直接拼到后端就能一一对应。

const BACKEND = 'http://47.116.181.216:3000';

// 跳过 Vercel 默认 bodyParser，让我们拿到原始 body 原样转发
// （登录/注册的 JSON、文件上传的 multipart 都能正常工作）
module.exports = async function handler(req, res) {
  try {
    const method = (req.method || 'GET').toUpperCase();

    // 1) 读取请求体
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      if (req.body !== undefined && req.body !== null) {
        // Vercel 已经帮我们解析过 body 了 —— 还原成字符串
        if (Buffer.isBuffer(req.body)) {
          body = req.body;
        } else if (typeof req.body === 'string') {
          body = req.body;
        } else {
          body = JSON.stringify(req.body);
        }
      } else {
        // 原始流
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });
      }
    }

    // 2) 复制请求头，去掉 host / content-length / connection（由 fetch 自己设置）
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      const lk = k.toLowerCase();
      if (['host', 'connection', 'content-length'].includes(lk)) continue;
      if (Array.isArray(v)) headers[k] = v.join(', ');
      else if (v !== undefined) headers[k] = String(v);
    }

    // 若我们手动序列化过 JSON，补上 content-type
    if (body && typeof body === 'string' && !headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json';
    }

    // 3) 转发到后端
    const target = BACKEND + req.url;
    const upstream = await fetch(target, { method, headers, body });

    // 4) 回写响应
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      // 跳过会被 Node/Vercel 自己处理的逐跳头
      if (['transfer-encoding', 'content-encoding', 'content-length', 'connection', 'keep-alive'].includes(lk)) return;
      res.setHeader(key, value);
    });

    const arrayBuf = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    res.status(502).json({
      error: 'Bad Gateway',
      message: String((err && err.message) || err),
      hint: '后端 47.116.181.216:3000 可能宕机或网络不通',
    });
  }
};

// Vercel Node.js runtime 的函数级配置
module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
