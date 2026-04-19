import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { linkSession, unlinkSession } from "../sessions.js";
import { sendMessageTo } from "../spectrum.js";
import { interactWithTerminal } from "../terminal-client.js";

const linkSchema = z.object({
  phone: z.string().min(1),
  deploymentId: z.string().min(1),
});

const unlinkSchema = z.object({
  phone: z.string().min(1),
});

const router = Router();

router.post("/", validate(linkSchema), (req, res) => {
  const { phone, deploymentId } = req.body;
  linkSession(phone, deploymentId);
  res.json({ status: "linked", phone, deploymentId });

  // Kick off the terminal session and text the first prompt to the user.
  // Fire-and-forget — the HTTP response is already sent so we don't make
  // the frontend wait on the sandbox spawn (can take a few seconds).
  (async () => {
    try {
      const output = await interactWithTerminal(deploymentId, "");
      await sendMessageTo(
        phone,
        `Terminal linked. Reply to this thread to interact.\n\n${output}`,
      );
    } catch (err) {
      console.error("link-session: failed to send first message:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      try {
        await sendMessageTo(phone, `Failed to start terminal: ${msg}`);
      } catch (sendErr) {
        console.error("link-session: also failed to notify user:", sendErr);
      }
    }
  })();
});

router.delete("/", validate(unlinkSchema), (req, res) => {
  const { phone } = req.body;
  unlinkSession(phone);
  res.json({ status: "unlinked", phone });
});

export default router;
