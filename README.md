# Bot de Telegram multi-herramienta 100% gratis

Bot personal de Johan (@bumiaabot): chat con IA y herramientas de todo tipo,
todas gratuitas y SIN llaves ni registros.

## Estado (14 nov 2026)

- Código en `~/workspace/ai-telegram-bot/` (webhook Vercel sin dependencias).
- Repo en GitHub: https://github.com/TecnoBum/ai-telegram-bot (público, creado vía
  navegador — la app de Muse no puede crear repos, 403).
- Bot verificado con getMe: @bumiaabot («bumiabot»). Token recibido por chat
  (uso transitorio, NO se guarda en archivos ni en memoria).
- **BLOQUEO: Vercel devuelve 403 en el equipo `tecnobum`** («Not authorized:
  Trying to access resource under scope tecnobum»). El token se refrescó y
  sigue igual; `authorize_team_access` no está expuesta en el MCP. Para que el
  bot corra hace falta un servidor: reconectar Vercel (con aprobación de
  Johan) o buscar otro host. GitHub solo hospeda el código: Pages es estático
  y Actions no da para un bot en vivo (los minutos gratis no alcanzan).

## Herramientas — todas verificadas en vivo el 14 nov 2026, sin llave

| Comando | Qué hace | Servicio |
|---|---|---|
| mensaje normal | Chat con IA | Pollinations texto (GPT-OSS 20B) |
| `/codigo <pedido>` | Escribe código | Pollinations, prompt solo-código |
| `/img <desc>` | Imagen (flux) | Pollinations imagen |
| `/img sana: <desc>` | Imagen (sana) | Pollinations imagen |
| `/voz <texto>` | Audio leído en español | Google Translate TTS (mp3) |
| `/wiki <tema>` | Resumen de Wikipedia | Wikipedia API |
| `/clima <ciudad>` | Clima actual | Open-Meteo (geo + forecast) |
| `/traducir <texto>` | Español ↔ inglés automático | Google Translate |
| `/convertir <n> <DE> <A>` | Monedas, tasa oficial (incluye CUP) | ExchangeRate-API |
| `/noticias [tema]` | Titulares del día (por defecto: Cuba) | Google News RSS |

Descartados tras probarlos: DuckDuckGo AI chat (reto anti-bots), búsqueda web
por DuckDuckGo HTML (bloqueado), Craiyon (sin respuesta), diccionario
español de dictionaryapi.dev (sin definiciones). Pollinations texto ya solo
ofrece `openai-fast` en tier anónimo (mistral/llama/deepseek dan 404).
**No hay IAs con token en el bot por orden de Johan** (Gemini, Groq,
OpenRouter y Hugging Face se quitaron el 13 nov 2026).

## Puesta en marcha (cuando haya servidor)

1. Crear proyecto `ai-telegram-bot` en Vercel (create_project).
2. Guardar el id en `vercel-project.json` y desplegar: `python3 deploy.py`.
3. Env vars en Vercel (production): `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`
   (valor en `.env.local`, no se sube). Sin llaves de IA.
4. Webhook: `POST https://api.telegram.org/bot<TOKEN>/setWebhook`
   con `url=https://ai-telegram-bot.vercel.app/api/webhook` y
   `secret_token=<WEBHOOK_SECRET>`.
5. Verificar: `getMe` + enviar `/start` al bot y comprobar la respuesta.
6. Bloquear el bot a su usuario: leer el `user_id` del log (`/start`),
   poner `ALLOWED_USER_ID` en Vercel y redesplegar.

## Notas

- Sin memoria de conversación en v1: cada mensaje es independiente.
  v2: persistir historial en Turso.
- Respuestas largas se parten en trozos de 4096 caracteres.
- `/voz` parte el texto en trozos de 180 caracteres (límite del TTS) y
  manda un audio por trozo.
- El token del bot NUNCA se guarda en archivos ni en memoria: uso
  transitorio para ponerlo en Vercel y configurar el webhook.
