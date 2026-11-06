export type TelegramResult =
  | { ok: true }
  | { ok: false; error: string };

const TELEGRAM_TIMEOUT_MS = 8_000;

/**
 * Sends an HTML-formatted Telegram message.
 *
 * Never throws: callers can persist telemetry even when Telegram is down.
 * The bot token and chat id are read from server-only environment variables.
 */
export async function sendTelegramAlert(
  message: string,
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return {
      ok: false,
      error:
        "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).",
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;

    if (!response.ok || !payload?.ok) {
      const description =
        payload?.description ?? `HTTP ${response.status} from Telegram.`;
      console.error("[telegram] sendMessage failed:", description);
      return { ok: false, error: description };
    }

    return { ok: true };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown Telegram error.";
    console.error("[telegram] sendMessage request failed:", messageText);
    return { ok: false, error: messageText };
  }
}
