# Bot de Telegram multi-IA gratis

Bot personal de Johan: escribe un mensaje y responde una IA; `/model` cambia
de modelo, `/img <descripción>` genera una imagen.

## Estado (14 nov 2026)

- Código listo en `api/webhook.js` (sin dependencias, webhook en Vercel).
- **BLOQUEO: Vercel devuelve 403 en el equipo `tecnobum`** («Not authorized:
  Trying to access resource under scope tecnobum»). El token se refrescó y
  sigue igual; la herramienta `authorize_team_access` no está expuesta en el
  MCP. Hay que desconectar y reconectar Vercel (con aprobación de Johan) para
  que la conexión vuelva a tener acceso al equipo, y luego crear el proyecto.
- Falta el token del bot (Johan lo crea en @BotFather y lo pega en el chat,
  como hizo con @KlikTienda_bot).

## IAs gratis verificadas en vivo (14 nov 2026)

| Proveedor | Modelos | Llave |
|---|---|---|
| Pollinations texto | GPT-OSS 20B (`openai`) | NO — verificado, responde |
| Pollinations imagen | Flux (`/img`) | NO — verificado, HTTP 200 |
| Google Gemini | Gemini 2.5 Flash | Sí, gratis (AI Studio) |
| Groq | Llama 3.3 70B | Sí, gratis |
| OpenRouter | Llama 3.3 70B, DeepSeek V3.1, Qwen3 235B, Gemma 3 27B (`:free`) | Sí, gratis |
| Hugging Face | Llama 3.3 70B, Qwen3 235B, DeepSeek R1 | Sí, gratis |

Descartado: DuckDuckGo AI chat — ahora pide resolver un reto anti-bots
(`x-vqd-hash-1`) y no es fiable para un bot. Pollinations ya solo ofrece
`openai-fast` en tier anónimo (mistral/llama/deepseek dan 404).

## Puesta en marcha (cuando Vercel vuelva)

1. Crear proyecto `ai-telegram-bot` en Vercel (create_project).
2. Guardar el id en `vercel-project.json` y desplegar: `python3 deploy.py`.
3. Env vars en Vercel (production): `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`
   (valor en `.env.local`, no se sube), y opcionales `GEMINI_API_KEY`,
   `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`.
4. Webhook: `POST https://api.telegram.org/bot<TOKEN>/setWebhook`
   con `url=https://ai-telegram-bot.vercel.app/api/webhook` y
   `secret_token=<WEBHOOK_SECRET>`.
5. Verificar: `getMe` + enviar `/start` al bot y comprobar la respuesta.
6. Bloquear el bot a su usuario: leer el `user_id` del log (`/start`),
   poner `ALLOWED_USER_ID` en Vercel y redesplegar.

## Notas

- Sin memoria de conversación en v1: cada mensaje es independiente.
  La elección de modelo vive en memoria del proceso (se pierde al
  reiniciar). v2: persistir modelo + historial en Turso.
- Respuestas largas se parten en trozos de 4096 caracteres.
- El token del bot NUNCA se guarda en archivos ni en memoria: uso
  transitorio para ponerlo en Vercel y configurar el webhook.
