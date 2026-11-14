export default function handler(req, res) {
  res.status(200).json({ ok: true, bot: "ai-telegram-bot", version: "1.0.0" });
}
