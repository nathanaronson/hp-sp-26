import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { env } from "./config/env.js";
import { getDeploymentForSender } from "./sessions.js";
import { interactWithTerminal } from "./terminal-client.js";

export const spectrum = await Spectrum({
  projectId: env.SPECTRUM_PROJECT_ID,
  projectSecret: env.SPECTRUM_PROJECT_SECRET,
  providers: [imessage.config()],
});

/**
 * Undo iMessage's "smart" autocorrect substitutions so code reaches the
 * terminal as the user typed it. iOS replaces straight quotes with curly
 * ones, double-dashes with em-dashes, ellipses with U+2026, etc. — all
 * fine for prose but fatal for a programming-language REPL.
 */
function normalizeSmartPunctuation(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

/** Send an iMessage to a phone number. */
export async function sendMessageTo(phone: string, text: string): Promise<void> {
  const im = imessage(spectrum);
  const user = await im.user(phone);
  const space = await im.space(user);
  await space.send(text);
}

export async function startMessageListener() {
  console.log("Spectrum message listener started");

  for await (const [space, message] of spectrum.messages) {
    if (message.content.type !== "text") continue;

    const senderId = message.sender.id;
    const text = normalizeSmartPunctuation(message.content.text);
    console.log(`[${message.platform}] ${senderId}: ${text}`);

    const deploymentId = getDeploymentForSender(senderId);
    if (!deploymentId) {
      await space.send("No active terminal session. Link a deployment first.");
      continue;
    }

    try {
      const output = await interactWithTerminal(deploymentId, text);
      await space.send(output);
    } catch (err) {
      console.error("Terminal interaction failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      await space.send(`Error: ${msg}`);
    }
  }
}
