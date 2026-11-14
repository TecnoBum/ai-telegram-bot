// Bot de Telegram multi-herramienta 100% GRATIS y SIN LLAVES — webhook para Vercel (v2).
// Chat generativo con memoria (KV de Vercel/Upstash, con fallback en memoria),
// respuestas con formato, y herramientas de todo tipo, todas sin registrarse:
//   Chat IA + código + resumir/explicar/ideas/poemas/historias/recetas/horóscopo:
//     Pollinations (GPT-OSS 20B)
//   Imágenes: Pollinations (flux, sana) · QR: qrserver · Voz: Google TTS
//   Wiki: Wikipedia · Clima: Open-Meteo · Traducir: Google Translate
//   Convertir: ExchangeRate-API · Noticias: Google News RSS · Chistes: JokeAPI
//   Música: iTunes Search · Cripto: CoinGecko · Dólar informal: tasas-cuba
//   Acortar: is.gd · Encuestas y dados: API nativa de Telegram
// El token del bot vive en TELEGRAM_BOT_TOKEN. WEBHOOK_SECRET protege el webhook.
// KV_REST_API_URL y KV_REST_API_TOKEN (opcionales) activan la memoria persistente.
// ALLOWED_USER_ID (opcional) restringe el bot a un solo usuario de Telegram.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || "";
const TG = TOKEN ? `https://api.telegram.org/bot${TOKEN}/` : "";
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

// ---- Utilidades ----
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
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Markdown del modelo -> HTML de Telegram (b, i, code, pre, a, viñetas).
function md2html(input) {
  let s = String(input || "");
  const pres = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, __, code) => {
    pres.push("<pre>" + escapeHtml(code.replace(/\n$/, "")) + "</pre>");
    return "\u0000" + (pres.length - 1) + "\u0000";
  });
  s = escapeHtml(s);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/^(?:-|\*)\s+/gm, "• ");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => pres[+i]);
  return s;
}

// Partir HTML largo en trozos <=4000 sin romper etiquetas b/i/code/pre/a.
function splitHtml(html, max = 4000) {
  const parts = [];
  let rest = html;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < 1000) cut = rest.lastIndexOf("\n", max);
    if (cut < 1000) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  const TAG = /<\/?(b|i|code|pre|a)(\s[^>]*)?>/g;
  const out = [];
  let open = [];
  for (const chunk of parts) {
    const stack = [...open];
    let m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(chunk))) {
      const full = m[0];
      if (full.startsWith("</")) {
        const idx = stack.lastIndexOf(full.slice(2, -1).split(" ")[0]);
        if (idx >= 0) stack.splice(idx, 1);
      } else {
        stack.push(full);
      }
    }
    const prefix = open.map((t) => t).join("");
    const suffix = [...stack].reverse().map((t) => "</" + t.slice(1).split(/[\s>]/)[0] + ">").join("");
    out.push(prefix + chunk + suffix);
    open = stack;
  }
  return out;
}

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
async function sendHtml(chatId, html, extra = {}) {
  let last = null;
  for (const c of splitHtml(html)) {
    last = await tg("sendMessage", { chat_id: chatId, text: c, parse_mode: "HTML", ...extra });
    if (!last.ok) {
      // Si Telegram rechaza el HTML (etiqueta rota), reintentar como texto plano.
      last = await tg("sendMessage", { chat_id: chatId, text: c.replace(/<[^>]+>/g, ""), ...extra });
    }
  }
  return last;
}
async function sendMessage(chatId, text, extra = {}) {
  return sendHtml(chatId, escapeHtml(text), extra);
}
const typing = (chatId) => tg("sendChatAction", { chat_id: chatId, action: "typing" });
async function withTyping(chatId, fn) {
  await typing(chatId);
  const timer = setInterval(() => typing(chatId).catch(() => {}), 4000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
// Subida multipart (para el mp3 de /voz): Telegram no siempre descarga el audio
// desde la URL de Google, así que lo bajamos aquí y lo subimos nosotros.
async function sendAudioUpload(chatId, bytes, filename, caption) {
  const boundary = "----botboundary" + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);
  const r = await fetch(TG + "sendAudio", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error("TG sendAudio error", JSON.stringify(j).slice(0, 300));
  return j;
}

// ---- Memoria (KV de Upstash; si no hay KV, mapa en memoria del proceso) ----
const memFallback = new Map();
async function kvCmd(cmd) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetchWithTimeout(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    }, 8000);
    const j = await r.json().catch(() => ({}));
    if (j.error) {
      console.error("KV error", String(j.error).slice(0, 200));
      return null;
    }
    return j.result ?? null;
  } catch (e) {
    console.error("KV fallo", String(e).slice(0, 120));
    return null;
  }
}
async function storeGet(key) {
  if (KV_URL && KV_TOKEN) {
    const v = await kvCmd(["GET", key]);
    if (v === null || v === undefined) return null;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  const e = memFallback.get(key);
  if (!e) return null;
  if (e.exp && Date.now() > e.exp) {
    memFallback.delete(key);
    return null;
  }
  return e.val;
}
async function storeSet(key, val, ttlSec = 604800) {
  if (KV_URL && KV_TOKEN) {
    await kvCmd(["SET", key, JSON.stringify(val), "EX", String(ttlSec)]);
    return;
  }
  memFallback.set(key, { val, exp: Date.now() + ttlSec * 1000 });
}
async function storeDel(key) {
  if (KV_URL && KV_TOKEN) {
    await kvCmd(["DEL", key]);
    return;
  }
  memFallback.delete(key);
}
const histKey = (chatId) => `hist:${chatId}`;
const nameKey = (chatId) => `name:${chatId}`;
const notesKey = (chatId) => `notes:${chatId}`;
async function getHistory(chatId) {
  const h = await storeGet(histKey(chatId));
  return Array.isArray(h) ? h : [];
}
async function pushHistory(chatId, role, content) {
  const h = await getHistory(chatId);
  h.push({ role, content: String(content).slice(0, 4000) });
  await storeSet(histKey(chatId), h.slice(-20), 604800); // últimas 10 conversaciones, 7 días
}

// ---- IA generativa (Pollinations, sin llave) ----
function personaPrompt(userName) {
  let p =
    "Eres Bumi, el asistente personal de TecnoBum en Telegram. Hablas español con tono cercano y claro, " +
    "como un amigo que sabe de tecnología. Responde de forma completa pero sin rollo; usa listas cuando ayuden. " +
    "Puedes usar formato Markdown simple (**negrita**, *cursiva*, `código`, listas con -). " +
    "Si te preguntan quién eres, di que eres Bumi, el bot multi-IA de TecnoBum. " +
    "Nunca inventes datos: si no sabes algo, dilo y ofrece buscarlo o explicarlo con lo que sabes.";
  if (userName) p += ` El usuario se llama ${userName}; úsalo de vez en cuando de forma natural.`;
  return p;
}
async function pollinations(messages, opts = {}) {
  const r = await fetchWithTimeout("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2500,
      seed: Math.floor(Math.random() * 100000),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.error || `HTTP ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error("respuesta vacía del modelo");
  return String(text).trim();
}
async function askAI(messages, opts) {
  return pollinations(messages, opts);
}
// Chat con memoria: envía el historial y guarda el intercambio.
async function chatAI(chatId, userText, userName) {
  const history = await getHistory(chatId);
  const messages = [{ role: "system", content: personaPrompt(userName) }, ...history, { role: "user", content: userText }];
  const answer = await askAI(messages);
  await pushHistory(chatId, "user", userText);
  await pushHistory(chatId, "assistant", answer);
  return answer;
}
async function oneShot(prompt, system) {
  return askAI([
    { role: "system", content: system || personaPrompt(null) },
    { role: "user", content: prompt },
  ]);
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
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto`,
    {}, 20000
  );
  const wj = await w.json().catch(() => ({}));
  const c = wj?.current;
  if (!c) throw new Error("no pude leer el clima ahora mismo");
  const name = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  let out = `${name}\n${WMO[c.weather_code] || "clima"} · ${c.temperature_2m}°C\nHumedad ${c.relative_humidity_2m}% · Viento ${c.wind_speed_10m} km/h`;
  const d = wj?.daily;
  if (d?.time?.length > 1) {
    const fmtDay = (iso) => {
      try {
        return new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
      } catch {
        return iso;
      }
    };
    out += "\n\nPróximos días:";
    for (let i = 1; i < d.time.length; i++) {
      out += `\n${fmtDay(d.time[i])}: ${d.temperature_2m_max[i]}°/${d.temperature_2m_min[i]}° · lluvia ${d.precipitation_probability_max?.[i] ?? "?"}%`;
    }
  }
  return out;
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
async function jokeEs() {
  const r = await fetchWithTimeout(
    "https://v2.jokeapi.dev/joke/Any?lang=es&type=single&blacklistFlags=nsfw,racist,sexist,explicit",
    {}, 20000
  );
  const j = await r.json().catch(() => ({}));
  if (j?.error || !j?.joke) throw new Error("no encontré chiste ahora mismo");
  return j.joke;
}
async function shortenUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("pásame un enlace que empiece por http");
  const r = await fetchWithTimeout("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(url), {}, 20000);
  const t = (await r.text()).trim();
  if (!r.ok || !t.startsWith("https://")) throw new Error("no pude acortar ese enlace");
  return t;
}
async function musicSearch(q) {
  const r = await fetchWithTimeout(
    "https://itunes.apple.com/search?term=" + encodeURIComponent(q) + "&media=music&limit=5",
    {}, 20000
  );
  const j = await r.json().catch(() => ({}));
  const results = (j?.results || []).filter((x) => x.trackName);
  if (!results.length) throw new Error("no encontré esa canción");
  return results.map((x) => ({
    track: x.trackName, artist: x.artistName, album: x.collectionName || "",
    preview: x.previewUrl || "", url: x.trackViewUrl || "",
  }));
}
const COINS = {
  btc: "bitcoin", bitcoin: "bitcoin", eth: "ethereum", ethereum: "ethereum",
  usdt: "tether", tether: "tether", bnb: "binancecoin", sol: "solana", solana: "solana",
  xrp: "ripple", doge: "dogecoin", dogecoin: "dogecoin", ada: "cardano", trx: "tron", ltc: "litecoin",
};
async function cryptoPrice(q) {
  const id = COINS[q.toLowerCase()] || q.toLowerCase();
  const r = await fetchWithTimeout(
    "https://api.coingecko.com/api/v3/simple/price?ids=" + encodeURIComponent(id) + "&vs_currencies=usd",
    {}, 20000
  );
  const j = await r.json().catch(() => ({}));
  const price = j?.[id]?.usd;
  if (!price) throw new Error("no encontré esa cripto (prueba: btc, eth, usdt, sol, xrp, doge)");
  let cup = "";
  try {
    const t = await fetchWithTimeout("https://tasas-cuba-tecnobum.vercel.app/tasas.json", {}, 15000);
    const tj = await t.json().catch(() => ({}));
    const usd = tj?.informal?.USD;
    if (usd) cup = `\n~${(price * usd).toLocaleString("es-ES", { maximumFractionDigits: 0 })} CUP (tasa informal)`;
  } catch {}
  return `${id.toUpperCase()}: $${price.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD${cup}`;
}
async function dolarCuba() {
  const r = await fetchWithTimeout("https://tasas-cuba-tecnobum.vercel.app/tasas.json", {}, 20000);
  const j = await r.json().catch(() => ({}));
  const inf = j?.informal;
  const of = j?.oficial;
  if (!inf) throw new Error("no pude leer las tasas ahora mismo");
  const fmt = (n) => n?.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  let out = `Tasa informal en Cuba (${j.fecha || "sin fecha"})`;
  for (const code of ["USD", "EUR", "MLC", "GBP", "CAD", "ZELLE"]) {
    if (inf[code] !== undefined) out += `\n${code}: ${fmt(inf[code])} CUP`;
  }
  if (of?.USD) out += `\n\nOficial: USD ${fmt(of.USD)} CUP · EUR ${fmt(of.EUR)} CUP`;
  return out;
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
function cubaTime() {
  const now = new Date();
  const fmt = (tz) => now.toLocaleString("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return `La Habana: ${fmt("America/Havana")}\nMiami: ${fmt("America/New_York")}\nMadrid: ${fmt("Europe/Madrid")}\nCiudad de México: ${fmt("America/Mexico_City")}`;
}

const CODE_PROMPT =
  "Eres un programador experto dentro de un bot de Telegram. Responde SOLO con código, sin explicaciones fuera del código. " +
  "Si hace falta una aclaración mínima, ponla como comentario dentro del código. Usa formato Markdown para el código.";
async function sendAI(chatId, text) {
  return sendHtml(chatId, md2html(text));
}

// ---- Textos del bot ----
function startText() {
  return (
    "Hola, soy Bumi, tu bot multi-IA de TecnoBum. Todo gratis y sin llaves, y ahora recuerdo nuestra conversación.\n\n" +
    "💬 Chat generativo\n" +
    "• Escríbeme lo que sea y te respondo con memoria\n" +
    "• /nuevo — empezar una conversación nueva\n" +
    "• /nombre <tu nombre> — para que te llame por tu nombre\n\n" +
    "✨ Crear con IA\n" +
    "• /codigo <pedido> — te escribo código\n" +
    "• /resumir <texto> — resumen en puntos (o responde a un mensaje con /resumir)\n" +
    "• /explica <tema> — explicado fácil\n" +
    "• /idea <tema> — 5 ideas\n" +
    "• /poema <tema> — un poema\n" +
    "• /historia <tema> — un cuento corto\n" +
    "• /receta <plato> — receta paso a paso\n" +
    "• /horoscopo <signo> — tu horóscopo\n" +
    "• /define <palabra> — qué significa\n" +
    "• /consejo — un consejo útil\n" +
    "• /chiste — un chiste en español\n\n" +
    "🖼️ Imágenes y voz\n" +
    "• /img <descripción> — creo una imagen (flux)\n" +
    "• /img sana: <descripción> — imagen con el modelo sana\n" +
    "• /voz <texto> — te lo leo en voz alta (o /voz en: <texto>)\n" +
    "• /qr <texto o enlace> — código QR\n\n" +
    "🔍 Buscar y saber\n" +
    "• /wiki <tema> — resumen de Wikipedia\n" +
    "• /clima <ciudad> — clima actual y 3 días\n" +
    "• /traducir <texto> — español ↔ inglés automático\n" +
    "• /convertir <cantidad> <DE> <A> — monedas, tasa oficial\n" +
    "• /dolar — tasa informal del dólar en Cuba\n" +
    "• /precio <cripto> — precio de bitcoin, ethereum y más\n" +
    "• /musica <canción> — busca la canción y escucha el adelanto\n" +
    "• /noticias [tema] — titulares del día (por defecto: Cuba)\n" +
    "• /acortar <enlace> — enlace corto\n\n" +
    "🎲 Diversión y notas\n" +
    "• /encuesta <pregunta> | <op1> | <op2> — crea una encuesta\n" +
    "• /dado — tira un dado\n" +
    "• /hora — hora en La Habana y el mundo\n" +
    "• /recordar <nota> — guardo una nota\n" +
    "• /notas — tus notas guardadas\n" +
    "• /olvidar [n] — borra una nota o todas\n\n" +
    "• /help — esta ayuda"
  );
}

// ---- Manejadores ----
function repliedText(msg) {
  return (msg.reply_to_message?.text || "").trim();
}
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
  const userName = await storeGet(nameKey(chatId)).catch(() => null);

  try {
    if (cmd("/start") || cmd("/help")) {
      await sendMessage(chatId, startText());
      return;
    }
    if (cmd("/nuevo")) {
      await storeDel(histKey(chatId));
      await sendMessage(chatId, "Listo, empezamos de cero. ¿De qué hablamos?");
      return;
    }
    if (cmd("/nombre")) {
      const name = arg("/nombre").slice(0, 40);
      if (!name) {
        await sendMessage(chatId, "Dime tu nombre: /nombre Johan");
        return;
      }
      await storeSet(nameKey(chatId), name, 2592000);
      await sendMessage(chatId, `Encantado, ${name}. Ya me acordaré de ti.`);
      return;
    }
    if (cmd("/recordar")) {
      const note = arg("/recordar").slice(0, 200);
      if (!note) {
        await sendMessage(chatId, "Dime qué guardo: /recordar comprar pan mañana");
        return;
      }
      const notes = (await storeGet(notesKey(chatId))) || [];
      if (!Array.isArray(notes)) throw new Error("notas corruptas");
      notes.push(note);
      await storeSet(notesKey(chatId), notes.slice(-20), 2592000);
      await sendMessage(chatId, `Guardado. Tienes ${notes.length} nota(s). Verlas: /notas`);
      return;
    }
    if (cmd("/notas")) {
      const notes = (await storeGet(notesKey(chatId))) || [];
      if (!notes.length) {
        await sendMessage(chatId, "No tienes notas guardadas. Usa /recordar <nota>.");
        return;
      }
      await sendMessage(chatId, "Tus notas:\n" + notes.map((n, i) => `${i + 1}. ${n}`).join("\n"));
      return;
    }
    if (cmd("/olvidar")) {
      const n = parseInt(arg("/olvidar"), 10);
      const notes = (await storeGet(notesKey(chatId))) || [];
      if (!isNaN(n) && notes[n - 1]) {
        notes.splice(n - 1, 1);
        await storeSet(notesKey(chatId), notes, 2592000);
        await sendMessage(chatId, `Borrada la nota ${n}.`);
      } else {
        await storeDel(notesKey(chatId));
        await sendMessage(chatId, "Borré todas tus notas.");
      }
      return;
    }
    if (cmd("/resumir")) {
      const input = arg("/resumir") || repliedText(msg);
      if (!input) {
        await sendMessage(chatId, "Pásame un texto o responde a un mensaje con /resumir.");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(
          `Resume este texto en español, en 5 puntos como máximo, sin perder lo esencial:\n\n${input.slice(0, 6000)}`,
          "Eres un editor experto que resume con precisión y brevedad."
        )
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/explica")) {
      const topic = arg("/explica");
      if (!topic) {
        await sendMessage(chatId, "Dime qué explico: /explica qué es un agujero negro");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(`Explica "${topic}" de forma sencilla, como si se lo explicaras a un niño de 10 años, con un ejemplo cotidiano.`, personaPrompt(userName))
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/idea")) {
      const topic = arg("/idea");
      if (!topic) {
        await sendMessage(chatId, "Dime sobre qué quieres ideas: /idea negocio en Cuba");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(`Dame 5 ideas creativas y concretas sobre: ${topic}. Cada idea con título y una línea de cómo llevarla a cabo.`, personaPrompt(userName))
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/poema")) {
      const topic = arg("/poema") || "la vida";
      const out = await withTyping(chatId, () =>
        oneShot(`Escribe un poema corto y bonito sobre: ${topic}.`, "Eres un poeta cubano de verso claro y emotivo.")
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/historia")) {
      const topic = arg("/historia") || "un pescador de La Habana";
      const out = await withTyping(chatId, () =>
        oneShot(`Escribe un cuento corto (menos de 300 palabras) sobre: ${topic}. Con inicio, giro y final.`, "Eres un narrador cubano de cuentos cortos.")
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/receta")) {
      const dish = arg("/receta");
      if (!dish) {
        await sendMessage(chatId, "Dime qué cocinamos: /receta arroz congrí");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(`Dame la receta de ${dish}: ingredientes con cantidades y pasos numerados, para 4 personas. Si es cubana, con su toque tradicional.`, personaPrompt(userName))
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/horoscopo")) {
      const sign = arg("/horoscopo");
      if (!sign) {
        await sendMessage(chatId, "Dime tu signo: /horoscopo leo");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(`Escribe el horóscopo de hoy para ${sign}: amor, dinero y salud, en 3 líneas cada uno, con tono positivo y un número de la suerte.`, "Eres un astrólogo ameno.")
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/define")) {
      const word = arg("/define");
      if (!word) {
        await sendMessage(chatId, "Dime qué palabra: /define serendipia");
        return;
      }
      const out = await withTyping(chatId, () =>
        oneShot(`Define "${word}" en español: qué significa, de dónde viene si se sabe, y un ejemplo de uso en una frase. Breve y claro.`, personaPrompt(userName))
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/consejo")) {
      const out = await withTyping(chatId, () =>
        oneShot("Dame un consejo útil y concreto para el día de hoy, algo que de verdad se pueda aplicar, en 3 líneas como máximo.", personaPrompt(userName))
      );
      await sendAI(chatId, out);
      return;
    }
    if (cmd("/chiste")) {
      try {
        const joke = await jokeEs();
        await sendMessage(chatId, joke);
      } catch {
        const out = await withTyping(chatId, () =>
          oneShot("Cuenta un chiste corto y bueno en español.", "Eres un humorista de chistes cortos.")
        );
        await sendAI(chatId, out);
      }
      return;
    }
    if (cmd("/codigo")) {
      const prompt = arg("/codigo");
      if (!prompt) {
        await sendMessage(chatId, "Dime qué código quieres: /codigo una función en Python que sume dos números");
        return;
      }
      const out = await withTyping(chatId, () => oneShot(prompt, CODE_PROMPT));
      await sendAI(chatId, out);
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
      await withTyping(chatId, async () => {
        const seed = Math.floor(Math.random() * 100000);
        const url =
          "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
          `?model=${model}&width=1024&height=1024&nologo=true&seed=${seed}`;
        const r = await tg("sendPhoto", { chat_id: chatId, photo: url, caption: prompt.slice(0, 900) });
        if (!r.ok) throw new Error("no pude generar la imagen");
      });
      return;
    }
    if (cmd("/voz")) {
      const raw = arg("/voz") || repliedText(msg);
      if (!raw) {
        await sendMessage(chatId, "Dime qué quieres escuchar: /voz Hola, soy tu bot");
        return;
      }
      let lang = "es";
      let spoken = raw;
      const lm = raw.match(/^(es|en|fr|de|it|pt)\s*:\s*(.+)$/i);
      if (lm) {
        lang = lm[1].toLowerCase();
        spoken = lm[2];
      }
      await withTyping(chatId, async () => {
        for (const chunk of ttsChunks(spoken)) {
          const url =
            "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(chunk) + "&tl=" + lang + "&client=gtx";
          const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 20000);
          if (!r.ok) throw new Error("no pude generar el audio");
          const buf = Buffer.from(await r.arrayBuffer());
          const sent = await sendAudioUpload(chatId, buf, "voz.mp3", chunk.slice(0, 200));
          if (!sent.ok) throw new Error("no pude enviar el audio");
        }
      });
      return;
    }
    if (cmd("/qr")) {
      const data = arg("/qr");
      if (!data) {
        await sendMessage(chatId, "Dime qué pongo en el QR: /qr https://tecnobum.github.io/mis-apks/");
        return;
      }
      const url = "https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=" + encodeURIComponent(data);
      const r = await tg("sendPhoto", { chat_id: chatId, photo: url, caption: data.slice(0, 900) });
      if (!r.ok) await sendMessage(chatId, "No pude generar el QR, inténtalo de nuevo.");
      return;
    }
    if (cmd("/acortar")) {
      const url = arg("/acortar");
      if (!url) {
        await sendMessage(chatId, "Pásame el enlace: /acortar https://ejemplo.com/pagina-larga");
        return;
      }
      const short = await withTyping(chatId, () => shortenUrl(url));
      await sendMessage(chatId, `Enlace corto:\n${short}`);
      return;
    }
    if (cmd("/musica")) {
      const q = arg("/musica");
      if (!q) {
        await sendMessage(chatId, "Dime qué canción: /musica Chan Chan");
        return;
      }
      const results = await withTyping(chatId, () => musicSearch(q));
      const lines = results.map((x, i) => `${i + 1}. ${x.track} — ${x.artist}${x.album ? ` (${x.album})` : ""}\n${x.url}`);
      await sendMessage(chatId, `Música: ${q}\n\n${lines.join("\n\n")}`);
      if (results[0]?.preview) {
        await tg("sendAudio", { chat_id: chatId, audio: results[0].preview, caption: `${results[0].track} — ${results[0].artist} (adelanto)` }).catch(() => {});
      }
      return;
    }
    if (cmd("/precio")) {
      const q = arg("/precio") || "bitcoin";
      const out = await withTyping(chatId, () => cryptoPrice(q));
      await sendMessage(chatId, out);
      return;
    }
    if (cmd("/dolar")) {
      const out = await withTyping(chatId, () => dolarCuba());
      await sendMessage(chatId, out);
      return;
    }
    if (cmd("/wiki")) {
      const topic = arg("/wiki");
      if (!topic) {
        await sendMessage(chatId, "Dime el tema: /wiki La Habana");
        return;
      }
      const w = await withTyping(chatId, () => wikiSummary(topic));
      await sendMessage(chatId, `${w.title}\n\n${w.extract}\n\n${w.url}`);
      return;
    }
    if (cmd("/clima")) {
      const city = arg("/clima");
      if (!city) {
        await sendMessage(chatId, "Dime la ciudad: /clima La Habana");
        return;
      }
      const out = await withTyping(chatId, () => weatherFor(city));
      await sendMessage(chatId, out);
      return;
    }
    if (cmd("/traducir")) {
      const input = arg("/traducir") || repliedText(msg);
      if (!input) {
        await sendMessage(chatId, "Dime qué traduzco: /traducir Hello world");
        return;
      }
      const t = await withTyping(chatId, () => translateAuto(input));
      await sendMessage(chatId, `${t.from} → ${t.to}\n${t.out}`);
      return;
    }
    if (cmd("/convertir")) {
      const parts = arg("/convertir").split(/\s+/);
      if (parts.length !== 3 || isNaN(parseFloat(parts[0]))) {
        await sendMessage(chatId, "Así: /convertir 100 USD CUP");
        return;
      }
      const out = await withTyping(chatId, () => convert(parseFloat(parts[0]), parts[1], parts[2]));
      await sendMessage(chatId, out);
      return;
    }
    if (cmd("/noticias")) {
      const topic = arg("/noticias") || "Cuba";
      const out = await withTyping(chatId, () => newsFor(topic));
      await sendMessage(chatId, out);
      return;
    }
    if (cmd("/encuesta")) {
      const parts = arg("/encuesta").split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) {
        await sendMessage(chatId, "Así: /encuesta ¿Pizza o pasta? | Pizza | Pasta | Las dos");
        return;
      }
      const r = await tg("sendPoll", {
        chat_id: chatId,
        question: parts[0].slice(0, 255),
        options: parts.slice(1, 11).map((t) => ({ text: t.slice(0, 100) })),
        is_anonymous: true,
      });
      if (!r.ok) await sendMessage(chatId, "No pude crear la encuesta, inténtalo de nuevo.");
      return;
    }
    if (cmd("/dado")) {
      const emojis = ["🎲", "🎯", "🏀", "⚽", "🎰"];
      await tg("sendDice", { chat_id: chatId, emoji: emojis[Math.floor(Math.random() * emojis.length)] });
      return;
    }
    if (cmd("/hora")) {
      await sendMessage(chatId, cubaTime());
      return;
    }
    if (text.startsWith("/")) {
      await sendMessage(chatId, "No conozco ese comando. Prueba /help.");
      return;
    }

    // Mensaje normal -> chat generativo con memoria
    const answer = await withTyping(chatId, () => chatAI(chatId, text, userName));
    await sendAI(chatId, answer);
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
