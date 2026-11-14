// Bot de Telegram multi-herramienta 100% GRATIS y SIN LLAVES — webhook para Vercel.
// Todo funciona sin registrarse en ningún servicio:
//   - Chat IA + código: Pollinations (GPT-OSS 20B)
//   - Imágenes: Pollinations (flux, sana)
//   - Voz: Google Translate TTS (mp3)
//   - Wiki: Wikipedia API · Clima: Open-Meteo · Traducir: Google Translate
//   - Convertir: ExchangeRate-API (tasa oficial, incluye CUP) · Noticias: Google News RSS
// El token del bot vive en TELEGRAM_BOT_TOKEN. WEBHOOK_SECRET protege el webhook.
// ALLOWED_USER_ID (opcional) restringe el bot a un solo usuario de Telegram.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || "";
const TG = TOKEN ? `https://api.telegram.org/bot${TOKEN}/` : "";

const SYSTEM_PROMPT =
  "Eres un asistente útil dentro de un bot de Telegram. Responde en español, de forma clara y directa. " +
  "Si la respuesta es larga, usa párrafos cortos. No uses formato Markdown complejo.";
const CODE_PROMPT =
  "Eres un programador experto dentro de un bot de Telegram. Responde SOLO con código, sin explicaciones fuera del código. " +
  "Si hace falta una aclaración mínima, ponla como comentario dentro del código.";

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
  for (const c of chunks) last = await tg("sendMessage", { chat_id: chatId, text: c, ...extra });
  return last;
}
const typing = (chatId) => tg("sendChatAction", { chat_id: chatId, action: "typing" });

// Subida multipart (para el mp3 de /voz): Telegram no siempre descarga el audio
// desde la URL de Google, así que lo bajamos aquí y lo subimos nosotros.
async function sendAudioUpload(chatId, mp3, filename, caption) {
  const boundary = "----botboundary" + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(mp3), tail]);
  const r = await fetch(TG + "sendAudio", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error("TG sendAudio error", JSON.stringify(j).slice(0, 300));
  return j;
}

async function fetchWithTimeout(url, opts = {}, ms = 50000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

// ---- IA de chat (Pollinations, sin llave) ----
async function askAI(userText, system = SYSTEM_PROMPT) {
  const r = await fetchWithTimeout("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.error || `HTTP ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error("respuesta vacía del modelo");
  return String(text).trim();
}

// ---- Herramientas gratuitas ----
async function wikiSummary(topic) {
  const url =
    "https://es.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&titles=" +
    encodeURIComponent(topic);
  const r = await fetchWithTimeout(url, {}, 20000);
  const j = await r.json().catch(() => ({}));
  const pages = j?.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing) throw new Error("no encontré ese tema en Wikipedia");
  const extract = (page.extract || "").trim();
  if (!extract) throw new Error("Wikipedia no tiene resumen para ese tema");
  return { title: page.title, extract: extract.slice(0, 1500), url: "https://es.wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")) };
}

const WMO = {
  0: "despejado", 1: "casi despejado", 2: "parcialmente nublado", 3: "nublado",
  45: "niebla", 48: "niebla con escarcha", 51: "llovizna ligera", 53: "llovizna",
  55: "llovizna intensa", 61: "lluvia ligera", 63: "lluvia", 65: "lluvia intensa",
  71: "nieve ligera", 73: "nieve", 75: "nieve intensa", 77: "granizo fino",
  80: "chubascos ligeros", 81: "chubascos", 82: "chubascos violentos",
  85: "chubascos de nieve", 86: "chubascos de nieve intensos",
  95: "tormenta eléctrica", 96: "tormenta con granizo", 99: "tormenta con granizo fuerte",
};
async function weatherFor(city) {
  const g = await fetchWithTimeout(
    "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=es&format=json",
    {}, 20000
  );
  const gj = await g.json().catch(() => ({}));
  const place = gj?.results?.[0];
  if (!place) throw new Error("no encontré esa ciudad");
  const w = await fetchWithTimeout(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
    {}, 20000
  );
  const wj = await w.json().catch(() => ({}));
  const c = wj?.current;
  if (!c) throw new Error("no pude leer el clima ahora mismo");
  const name = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  return `${name}\n${WMO[c.weather_code] || "clima"} · ${c.temperature_2m}°C\nHumedad ${c.relative_humidity_2m}% · Viento ${c.wind_speed_10m} km/h`;
}

async function translateOnce(text, target) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + target + "&dt=t&q=" +
    encodeURIComponent(text);
  const r = await fetchWithTimeout(url, {}, 20000);
  const j = await r.json().catch(() => null);
  if (!j || !j[0]) throw new Error("no pude traducir ahora mismo");
  const out = j[0].map((p) => p[0] || "").join("");
  const src = j[2] || "auto";
  return { out, src };
}
async function translateAuto(text) {
  const first = await translateOnce(text, "en");
  if (first.src === "en") {
    const second = await translateOnce(text, "es");
    return { from: "EN", to: "ES", out: second.out };
  }
  return { from: (first.src || "AUTO").toUpperCase(), to: "EN", out: first.out };
}

async function convert(amount, from, to) {
  const r = await fetchWithTimeout("https://open.er-api.com/v6/latest/" + encodeURIComponent(from.toUpperCase()), {}, 20000);
  const j = await r.json().catch(() => ({}));
  if (j?.result !== "success") throw new Error("esa moneda no existe o no pude leer la tasa");
  const rate = j.rates?.[to.toUpperCase()];
  if (!rate) throw new Error("no hay tasa para " + to.toUpperCase());
  const value = amount * rate;
  const fmt = (n) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  return `${fmt(amount)} ${from.toUpperCase()} = ${fmt(value)} ${to.toUpperCase()}\nTasa oficial: 1 ${from.toUpperCase()} = ${fmt(rate)} ${to.toUpperCase()}`;
}

async function newsFor(topic) {
  const url =
    "https://news.google.com/rss/search?q=" + encodeURIComponent(topic) + "&hl=es-419&gl=CU&ceid=CU:es-419";
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 20000);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
  if (!items.length) throw new Error("no encontré noticias de ese tema");
  const lines = items.map(([_, body], i) => {
    const title = decodeEntities((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = decodeEntities((body.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
    const clean = title.replace(/\s+-\s+[^-]+$/, "").trim();
    return `${i + 1}. ${clean}\n${link}`;
  });
  return `Noticias: ${topic}\n\n${lines.join("\n\n")}`;
}

function ttsChunks(text) {
  const words = text.split(/\s+/);
  const chunks = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 180) {
      if (cur) chunks.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks.slice(0, 5);
}

// ---- Textos del bot ----
function startText() {
  return (
    "Hola, soy tu bot multi-IA, 100% gratis y sin llaves. Escribe cualquier mensaje y te respondo con la IA.\n\n" +
    "Lo que puedo hacer:\n" +
    "• Chat con IA: escríbeme lo que sea\n" +
    "• /codigo <pedido> — te escribo código\n" +
    "• /img <descripción> — creo una imagen (flux)\n" +
    "• /img sana: <descripción> — imagen con el modelo sana\n" +
    "• /voz <texto> — te lo leo en voz alta (audio)\n" +
    "• /wiki <tema> — resumen de Wikipedia\n" +
    "• /clima <ciudad> — clima actual\n" +
    "• /traducir <texto> — español ↔ inglés automático\n" +
    "• /convertir <cantidad> <DE> <A> — monedas, tasa oficial (ej: /convertir 100 USD CUP)\n" +
    "• /noticias [tema] — titulares del día (por defecto: Cuba)\n" +
    "• /help — esta ayuda\n\n" +
    "Cada mensaje es independiente por ahora: no recuerdo la conversación anterior."
  );
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

  const cmd = (name) => text === name || text.startsWith(name + " ") || text.startsWith(name + "@");
  const arg = (name) => text.replace(new RegExp("^" + name + "(@\\w+)?\\s*"), "").trim();

  try {
    if (cmd("/start")) {
      await sendMessage(chatId, startText());
      return;
    }
    if (cmd("/help")) {
      await sendMessage(chatId, startText());
      return;
    }
    if (cmd("/codigo")) {
      const prompt = arg("/codigo");
      if (!prompt) {
        await sendMessage(chatId, "Dime qué código quieres: /codigo una función en Python que sume dos números");
        return;
      }
      await typing(chatId);
      await sendMessage(chatId, await askAI(prompt, CODE_PROMPT));
      return;
    }
    if (cmd("/img")) {
      const raw = arg("/img");
      if (!raw) {
        await sendMessage(chatId, "Dime qué imagen quieres: /img un gato astronauta en La Habana");
        return;
      }
      let model = "flux";
      let prompt = raw;
      const m = raw.match(/^(flux|sana)\s*:\s*(.+)$/i);
      if (m) {
        model = m[1].toLowerCase();
        prompt = m[2];
      }
      await typing(chatId);
      const seed = Math.floor(Math.random() * 100000);
      const url =
        "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
        `?model=${model}&width=1024&height=1024&nologo=true&seed=${seed}`;
      const r = await tg("sendPhoto", { chat_id: chatId, photo: url, caption: prompt.slice(0, 900) });
      if (!r.ok) await sendMessage(chatId, "No pude generar la imagen, inténtalo de nuevo.");
      return;
    }
    if (cmd("/voz")) {
      const spoken = arg("/voz");
      if (!spoken) {
        await sendMessage(chatId, "Dime qué quieres escuchar: /voz Hola, soy tu bot");
        return;
      }
      await typing(chatId);
      for (const chunk of ttsChunks(spoken)) {
        const url =
          "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(chunk) + "&tl=es&client=gtx";
        const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 20000);
        if (!r.ok) throw new Error("no pude generar el audio");
        const buf = Buffer.from(await r.arrayBuffer());
        const sent = await sendAudioUpload(chatId, buf, "voz.mp3", chunk.slice(0, 200));
        if (!sent.ok) {
          await sendMessage(chatId, "No pude enviar el audio, inténtalo de nuevo.");
          return;
        }
      }
      return;
    }
    if (cmd("/wiki")) {
      const topic = arg("/wiki");
      if (!topic) {
        await sendMessage(chatId, "Dime el tema: /wiki La Habana");
        return;
      }
      await typing(chatId);
      const w = await wikiSummary(topic);
      await sendMessage(chatId, `${w.title}\n\n${w.extract}\n\n${w.url}`);
      return;
    }
    if (cmd("/clima")) {
      const city = arg("/clima");
      if (!city) {
        await sendMessage(chatId, "Dime la ciudad: /clima La Habana");
        return;
      }
      await typing(chatId);
      await sendMessage(chatId, await weatherFor(city));
      return;
    }
    if (cmd("/traducir")) {
      const input = arg("/traducir");
      if (!input) {
        await sendMessage(chatId, "Dime qué traduzco: /traducir Hello world");
        return;
      }
      await typing(chatId);
      const t = await translateAuto(input);
      await sendMessage(chatId, `${t.from} → ${t.to}\n${t.out}`);
      return;
    }
    if (cmd("/convertir")) {
      const parts = arg("/convertir").split(/\s+/);
      if (parts.length !== 3 || isNaN(parseFloat(parts[0]))) {
        await sendMessage(chatId, "Así: /convertir 100 USD CUP");
        return;
      }
      await typing(chatId);
      await sendMessage(chatId, await convert(parseFloat(parts[0]), parts[1], parts[2]));
      return;
    }
    if (cmd("/noticias")) {
      const topic = arg("/noticias") || "Cuba";
      await typing(chatId);
      await sendMessage(chatId, await newsFor(topic));
      return;
    }
    if (text.startsWith("/")) {
      await sendMessage(chatId, "No conozco ese comando. Prueba /help.");
      return;
    }

    // Mensaje normal -> IA de chat
    await typing(chatId);
    await sendMessage(chatId, await askAI(text));
  } catch (e) {
    console.error("handler error", String(e).slice(0, 300));
    await sendMessage(chatId, `No pude hacerlo ahora mismo: ${String(e.message || e).slice(0, 200)}\n\nPrueba de nuevo o usa /help.`);
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
  } catch (e) {
    console.error("handler error", String(e).slice(0, 300));
  }
  res.status(200).json({ ok: true });
}
