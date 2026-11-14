// Bot de Telegram multi-IA gratis — webhook para Vercel (sin dependencias).
// Proveedores sin llave: Pollinations (texto + imágenes).
// Proveedores con llave gratuita (opcionales, se activan solos si la env existe):
//   GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN.
// El token del bot vive en TELEGRAM_BOT_TOKEN. WEBHOOK_SECRET protege el webhook.
// ALLOWED_USER_ID (opcional) restringe el bot a un solo usuario de Telegram.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || "";
const TG = TOKEN ? `https://api.telegram.org/bot${TOKEN}/` : "";

// ---- Catálogo de modelos ----
const MODELS = [
  { id: "pollinations-openai", label: "GPT-OSS 20B", provider: "Pollinations", free: true, key: null,
    note: "gratis, sin llave" },
  { id: "gemini-flash", label: "Gemini 2.5 Flash", provider: "Google", free: true, key: "GEMINI_API_KEY",
    note: "llave gratis de Google AI Studio" },
  { id: "groq-llama", label: "Llama 3.3 70B", provider: "Groq", free: true, key: "GROQ_API_KEY",
    note: "llave gratis de Groq" },
  { id: "openrouter-llama", label: "Llama 3.3 70B", provider: "OpenRouter", free: true, key: "OPENROUTER_API_KEY",
    note: "modelo :free de OpenRouter" },
  { id: "openrouter-deepseek", label: "DeepSeek V3.1", provider: "OpenRouter", free: true, key: "OPENROUTER_API_KEY",
    note: "modelo :free de OpenRouter" },
  { id: "openrouter-qwen", label: "Qwen3 235B", provider: "OpenRouter", free: true, key: "OPENROUTER_API_KEY",
    note: "modelo :free de OpenRouter" },
  { id: "openrouter-gemma", label: "Gemma 3 27B", provider: "OpenRouter", free: true, key: "OPENROUTER_API_KEY",
    note: "modelo :free de OpenRouter" },
  { id: "hf-llama", label: "Llama 3.3 70B", provider: "Hugging Face", free: true, key: "HF_TOKEN",
    note: "llave gratis de Hugging Face" },
  { id: "hf-qwen", label: "Qwen3 235B", provider: "Hugging Face", free: true, key: "HF_TOKEN",
    note: "llave gratis de Hugging Face" },
  { id: "hf-deepseek", label: "DeepSeek R1", provider: "Hugging Face", free: true, key: "HF_TOKEN",
    note: "llave gratis de Hugging Face" },
];

const DEFAULT_MODEL = "pollinations-openai";
const chatModel = new Map(); // chatId -> modelId (en memoria; v2 lo persistirá en Turso)

function availableModels() {
  return MODELS.filter((m) => !m.key || process.env[m.key]);
}
function modelById(id) {
  return MODELS.find((m) => m.id === id) || null;
}
function modelFor(chatId) {
  const id = chatModel.get(String(chatId)) || DEFAULT_MODEL;
  const m = modelById(id);
  if (m && (!m.key || process.env[m.key])) return m;
  return modelById(DEFAULT_MODEL);
}

const SYSTEM_PROMPT =
  "Eres un asistente útil dentro de un bot de Telegram. Responde en español, de forma clara y directa. " +
  "Si la respuesta es larga, usa párrafos cortos. No uses formato Markdown complejo.";

// ---- Cliente Telegram ----
async function tg(method, body) {
  const r = await fetch(TG + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error("TG error", method, JSON.stringify(j).slice(0, 400));
  return j;
}
async function sendMessage(chatId, text, extra = {}) {
  // Telegram corta en 4096 caracteres: partir en trozos.
  const chunks = [];
  let rest = text || "";
  while (rest.length > 4096) {
    let cut = rest.lastIndexOf("\n", 4096);
    if (cut < 1000) cut = 4096;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  let last = null;
  for (const c of chunks) {
    last = await tg("sendMessage", { chat_id: chatId, text: c, ...extra });
  }
  return last;
}
const typing = (chatId) => tg("sendChatAction", { chat_id: chatId, action: "typing" });

// ---- Proveedores de IA ----
async function fetchWithTimeout(url, opts, ms = 50000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
async function openaiShapeChat(url, headers, model, messages) {
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.error || `HTTP ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error("respuesta vacía del modelo");
  return String(text).trim();
}

async function askAI(model, userText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];
  switch (model.id) {
    case "pollinations-openai": {
      return openaiShapeChat("https://text.pollinations.ai/", {}, "openai", messages);
    }
    case "gemini-flash": {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(process.env.GEMINI_API_KEY);
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\n" + userText }] }],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
      const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      if (!text) throw new Error("respuesta vacía del modelo");
      return text.trim();
    }
    case "groq-llama":
      return openaiShapeChat(
        "https://api.groq.com/openai/v1/chat/completions",
        { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        "llama-3.3-70b-versatile",
        messages
      );
    case "openrouter-llama":
      return openaiShapeChat(
        "https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        "meta-llama/llama-3.3-70b-instruct:free",
        messages
      );
    case "openrouter-deepseek":
      return openaiShapeChat(
        "https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        "deepseek/deepseek-chat-v3.1:free",
        messages
      );
    case "openrouter-qwen":
      return openaiShapeChat(
        "https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        "qwen/qwen3-235b-a22b:free",
        messages
      );
    case "openrouter-gemma":
      return openaiShapeChat(
        "https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        "google/gemma-3-27b-it:free",
        messages
      );
    case "hf-llama":
      return openaiShapeChat(
        "https://router.huggingface.co/v1/chat/completions",
        { Authorization: `Bearer ${process.env.HF_TOKEN}` },
        "meta-llama/Llama-3.3-70B-Instruct",
        messages
      );
    case "hf-qwen":
      return openaiShapeChat(
        "https://router.huggingface.co/v1/chat/completions",
        { Authorization: `Bearer ${process.env.HF_TOKEN}` },
        "Qwen/Qwen3-235B-A22B-Instruct-2507",
        messages
      );
    case "hf-deepseek":
      return openaiShapeChat(
        "https://router.huggingface.co/v1/chat/completions",
        { Authorization: `Bearer ${process.env.HF_TOKEN}` },
        "deepseek-ai/DeepSeek-R1",
        messages
      );
    default:
      throw new Error("modelo no configurado: " + model.id);
  }
}

// ---- Textos del bot ----
function startText() {
  const avail = availableModels();
  const lines = avail.map((m) => `• ${m.label} (${m.provider}) — ${m.note}`);
  return (
    "Hola, soy tu bot multi-IA. Escribe cualquier mensaje y te respondo con el modelo activo.\n\n" +
    "Modelos disponibles ahora:\n" +
    lines.join("\n") +
    "\n\nComandos:\n" +
    "/model — cambiar de modelo\n" +
    "/img <descripción> — generar una imagen gratis\n" +
    "/help — ayuda\n\n" +
    "Si luego agregas llaves gratuitas (Gemini, Groq, OpenRouter o Hugging Face), esos modelos aparecen solos en /model, sin tocar el bot."
  );
}
function modelKeyboard() {
  const rows = availableModels().map((m) => [
    { text: `${m.label} · ${m.provider}`, callback_data: `model:${m.id}` },
  ]);
  return { inline_keyboard: rows };
}

// ---- Manejadores ----
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || "").trim();
  console.log("msg from", userId, "chat", chatId, "len", text.length);

  if (ALLOWED_USER_ID && String(userId) !== String(ALLOWED_USER_ID)) {
    await sendMessage(chatId, "Este bot es privado.");
    return;
  }
  if (!text) return;

  if (text === "/start") {
    await sendMessage(chatId, startText());
    return;
  }
  if (text === "/help") {
    await sendMessage(
      chatId,
      "Escribe cualquier mensaje y te respondo con el modelo activo.\n\n/model — ver y cambiar de modelo\n/img <descripción> — generar una imagen gratis\n\nCada mensaje es independiente por ahora: el bot no recuerda la conversación anterior."
    );
    return;
  }
  if (text === "/model") {
    const cur = modelFor(chatId);
    await sendMessage(chatId, `Modelo activo: ${cur.label} (${cur.provider}).\nElige otro:`, {
      reply_markup: modelKeyboard(),
    });
    return;
  }
  if (text.startsWith("/img")) {
    const prompt = text.replace(/^\/img(@\w+)?\s*/, "").trim();
    if (!prompt) {
      await sendMessage(chatId, "Dime qué imagen quieres: /img un gato astronauta en La Habana");
      return;
    }
    await typing(chatId);
    const seed = Math.floor(Math.random() * 100000);
    const url =
      "https://image.pollinations.ai/prompt/" +
      encodeURIComponent(prompt) +
      `?model=flux&width=1024&height=1024&nologo=true&seed=${seed}`;
    const r = await tg("sendPhoto", {
      chat_id: chatId,
      photo: url,
      caption: prompt.slice(0, 900),
    });
    if (!r.ok) await sendMessage(chatId, "No pude generar la imagen, inténtalo de nuevo.");
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, "No conozco ese comando. Prueba /help.");
    return;
  }

  // Mensaje normal -> IA
  const model = modelFor(chatId);
  await typing(chatId);
  try {
    const answer = await askAI(model, text);
    await sendMessage(chatId, answer);
  } catch (e) {
    console.error("AI error", model.id, String(e).slice(0, 300));
    await sendMessage(
      chatId,
      `El modelo ${model.label} (${model.provider}) falló ahora mismo: ${String(e.message || e).slice(0, 200)}\n\nPrueba de nuevo o cambia de modelo con /model.`
    );
  }
}

async function handleCallback(q) {
  const chatId = q.message?.chat?.id;
  if (!chatId) return;
  const data = q.callback_query?.data || q.data || "";
  const userId = q.from?.id;
  if (ALLOWED_USER_ID && String(userId) !== String(ALLOWED_USER_ID)) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Bot privado." });
    return;
  }
  if (data.startsWith("model:")) {
    const id = data.slice("model:".length);
    const m = modelById(id);
    if (!m || (m.key && !process.env[m.key])) {
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Ese modelo no está disponible." });
      return;
    }
    chatModel.set(String(chatId), id);
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: `Modelo: ${m.label}` });
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: q.message.message_id,
      text: `Modelo activo: ${m.label} (${m.provider}).\nYa puedes escribirme.`,
    });
  }
}

// ---- Webhook ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).json({ ok: true, bot: "ai-telegram-bot", webhook: "POST updates here" });
    return;
  }
  if (SECRET) {
    const got = req.headers["x-telegram-bot-api-secret-token"];
    if (got !== SECRET) {
      res.status(403).json({ ok: false, error: "bad secret" });
      return;
    }
  }
  if (!TOKEN) {
    res.status(200).json({ ok: false, error: "TELEGRAM_BOT_TOKEN no configurado" });
    return;
  }
  let update = req.body;
  if (typeof update === "string") {
    try {
      update = JSON.parse(update);
    } catch {
      update = {};
    }
  }
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  } catch (e) {
    console.error("handler error", String(e).slice(0, 300));
  }
  res.status(200).json({ ok: true });
}
