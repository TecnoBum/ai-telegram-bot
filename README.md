# Bot de Telegram multi-IA gratis — @bumiaabot

Bot de Telegram 100% gratis y sin llaves, con **chat generativo con memoria**, respuestas con formato y herramientas de todo tipo. Desplegado en Vercel (serverless, sin dependencias). Los despliegues son automáticos: cada push a `main` redespliega en producción.

- **Bot:** @bumiaabot
- **Producción:** https://ai-telegram-bot-rho.vercel.app
- **Webhook:** `https://ai-telegram-bot-rho.vercel.app/api/webhook`
- **Repo:** https://github.com/TecnoBum/ai-telegram-bot

## Qué hace (v2.1)

**💬 Chat generativo con memoria**
- Escribe lo que sea: responde con contexto de la conversación (últimos 10 intercambios, 7 días).
- `/nuevo` — empezar de cero · `/nombre <nombre>` — te llama por tu nombre.
- `/recordar <nota>` · `/notas` · `/olvidar [n]` — notas guardadas.

**🗣️ Lenguaje natural (v2.1, sin comandos):** el bot entiende pedidos con palabras normales y ejecuta la acción: «cuéntame un chiste», «cómo está el dólar», «qué hora es en Madrid», «hazme un QR de mi web», «busca la canción Chan Chan», «100 dólares a CUP», «qué es un agujero negro», «me llamo Johan», «recuerda que tengo que llamar a Ana», «haz una encuesta: ¿Pizza o pasta? | Pizza | Pasta», «tira un dado». Si falta un dato (por ejemplo la ciudad del clima), pregunta y usa tu siguiente mensaje como respuesta. Si no entiende la intención, responde con el chat normal.

**✨ Crear con IA** (Pollinations, GPT-OSS 20B, sin llave): `/codigo`, `/resumir` (texto o mensaje respondido), `/explica`, `/idea`, `/poema`, `/historia`, `/receta`, `/horoscopo`, `/define`, `/consejo`, `/chiste` (JokeAPI).

**🖼️ Imágenes y voz:** `/img <desc>` (flux) y `/img sana: <desc>`, `/voz <texto>` (`/voz en: <texto>`), `/qr <texto o enlace>` (qrserver).

**🔍 Buscar y saber:** `/wiki` (Wikipedia), `/clima <ciudad>` (Open-Meteo, actual + 3 días), `/traducir` (Google Translate, ES↔EN auto), `/convertir <cantidad> <DE> <A>` (ExchangeRate-API, tasa oficial), `/dolar` (tasa informal en Cuba, desde tasas-cuba), `/precio <cripto>` (CoinGecko + CUP informal), `/musica <canción>` (iTunes, con adelanto en audio), `/noticias [tema]` (Google News RSS), `/acortar <enlace>` (is.gd).

**🎲 Telegram nativo:** `/encuesta <pregunta> | <op1> | <op2>`, `/dado`, `/hora` (La Habana y el mundo).

## Memoria persistente (KV)

La memoria de chat usa **Vercel KV (Upstash)**. En el panel de Vercel: Storage → Create Database → KV → conéctalo al proyecto `ai-telegram-bot`; Vercel añade `KV_REST_API_URL` y `KV_REST_API_TOKEN` como variables de entorno y hay que redesplegar. Sin KV el bot sigue funcionando: la memoria queda solo en el proceso (se pierde al reiniciarse).

## Variables de entorno (Vercel → Settings → Environment Variables, Production)

| Variable | Para qué |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather |
| `WEBHOOK_SECRET` | Secreto que Telegram envía en `x-telegram-bot-api-secret-token` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Memoria persistente (la pone Vercel al conectar el KV) |
| `ALLOWED_USER_ID` | (opcional) restringe el bot a un solo `user_id` de Telegram |

## Configurar el webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  --data-urlencode "url=https://ai-telegram-bot-rho.vercel.app/api/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>"
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## Archivos

- `api/webhook.js` — todo el bot (sin dependencias)
- `api/index.js` — health check (`GET /api/` → `{"ok":true}`)
- `vercel.json` — funciones con `maxDuration: 60`
- `package.json` — sin dependencias
- `deploy.py` — script de despliegue por la API de Vercel (legado; hoy el despliegue es automático por Git)

## Descartados (probados, no funcionan sin llave)

DuckDuckGo AI chat (reto anti-bots), búsqueda DDG HTML (0 resultados), Craiyon (sin respuesta), dictionaryapi.dev en español (sin definiciones), modelos de texto de Pollinations más allá de `openai-fast` (404), Wiktionary (extractos vacíos).
