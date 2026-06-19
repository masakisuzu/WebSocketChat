// const express = require("express");
// const app = express();
// const port = process.env.PORT || 3001;

// app.get("/", (req, res) => res.type('html').send(html));

// const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

// server.keepAliveTimeout = 120 * 1000;
// server.headersTimeout = 120 * 1000;
// /
// const html = `
// <!DOCTYPE html>
// <html>
//   <head>
//     <title>Hello from Render!</title>
//     <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js"></script>
//     <script>
//       setTimeout(() => {
//         confetti({
//           particleCount: 100,
//           spread: 70,
//           origin: { y: 0.6 },
//           disableForReducedMotion: true
//         });
//       }, 500);
//     </script>
//     <style>
//       @import url("https://p.typekit.net/p.css?s=1&k=vnd5zic&ht=tk&f=39475.39476.39477.39478.39479.39480.39481.39482&a=18673890&app=typekit&e=css");
//       @font-face {
//         font-family: "neo-sans";
//         src: url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff2"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/d?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/a?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("opentype");
//         font-style: normal;
//         font-weight: 700;
//       }
//       html {
//         font-family: neo-sans;
//         font-weight: 700;
//         font-size: calc(62rem / 16);
//       }
//       body {
//         background: white;
//       }
//       section {
//         border-radius: 1em;
//         padding: 1em;
//         position: absolute;
//         top: 50%;
//         left: 50%;
//         margin-right: -50%;
//         transform: translate(-50%, -50%);
//       }
//     </style>
//   </head>
//   <body>
//     <section>
//       Hello from Render!
//     </section>
//   </body>
// </html>
// `
const express = require("express");
const expressWs = require("express-ws");

const app = express();

// ExpressでWebSocketルートを扱えるようにする
expressWs(app);

const port = process.env.PORT || 3001;

// 現在接続しているWebSocketを管理する
const connections = new Set();

// 描画イベントとして許可する操作
const allowedPaintControls = new Set([
  "mousedown",
  "mousemove",
  "mouseup",
  "mouseout",
]);

// public/index.htmlなどをブラウザへ公開する
app.use(express.static("public"));

// サーバーの稼働確認用
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connections: connections.size,
  });
});

/**
 * クライアントから受信したJSONが正しい形式か検証する
 */
function isValidMessage(data) {
  if (!data || typeof data !== "object") {
    return false;
  }

  if (data.type === "chat") {
    return (
      typeof data.id === "string" &&
      data.id.length > 0 &&
      data.id.length <= 64 &&
      typeof data.text === "string" &&
      data.text.trim().length > 0 &&
      data.text.length <= 500
    );
  }

  if (data.type === "paint") {
    return (
      typeof data.id === "string" &&
      data.id.length > 0 &&
      data.id.length <= 64 &&
      Number.isFinite(data.x) &&
      Number.isFinite(data.y) &&
      data.x >= 0 &&
      data.x <= 600 &&
      data.y >= 0 &&
      data.y <= 600 &&
      allowedPaintControls.has(data.control)
    );
  }

  return false;
}

/**
 * 接続中の全クライアントへメッセージを送信する
 */
function broadcast(payload) {
  for (const socket of connections) {
    // readyState === 1 は接続中を表す
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

// WebSocket接続先
app.ws("/ws", (ws) => {
  connections.add(ws);

  console.log(`WebSocket connected: ${connections.size}`);

  ws.on("message", (message) => {
    // express-wsではBufferとして届く場合があるため文字列化する
    const receivedText = message.toString();

    // 非常に大きなメッセージを拒否する
    if (Buffer.byteLength(receivedText, "utf8") > 100_000) {
      console.warn("Message rejected: too large");
      return;
    }

    let data;

    try {
      data = JSON.parse(receivedText);
    } catch (error) {
      console.warn("Message rejected: invalid JSON");
      return;
    }

    if (!isValidMessage(data)) {
      console.warn("Message rejected: invalid format", data);
      return;
    }

    // チャットの前後の空白を削除する
    if (data.type === "chat") {
      data.text = data.text.trim();
    }

    const payload = JSON.stringify(data);

    console.log("Received:", payload);

    // 送信者を含む全クライアントへ配信
    broadcast(payload);
  });

  const removeConnection = () => {
    connections.delete(ws);
    console.log(`WebSocket disconnected: ${connections.size}`);
  };

  ws.on("close", removeConnection);

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    removeConnection();
  });
});

// HTTPサーバーを起動する
const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

// Renderなどのプロキシ環境を考慮する
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

/**
 * Renderなどから終了命令を受け取った場合、
 * 接続を安全に閉じてから終了する
 */
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down...");

  for (const socket of connections) {
    socket.close(1001, "Server shutting down");
  }

  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
});