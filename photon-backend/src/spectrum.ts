import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { env } from "./config/env.js";

export const spectrum = await Spectrum({
  projectId: env.SPECTRUM_PROJECT_ID,
  projectSecret: env.SPECTRUM_PROJECT_SECRET,
  providers: [imessage.config()],
});

export async function startMessageListener() {
  console.log("Spectrum message listener started");

  for await (const [space, message] of spectrum.messages) {
    if (message.content.type === "text") {
      console.log(`[${message.platform}] ${message.sender.id}: ${message.content.text}`);
      await space.send("hello world");
    }
  }
}
