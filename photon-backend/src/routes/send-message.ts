import { Router } from "express";
import { z } from "zod";
import { imessage } from "spectrum-ts/providers/imessage";
import { validate } from "../middleware/validate.js";
import { spectrum } from "../spectrum.js";

const sendMessageSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1),
});

const router = Router();

router.post("/", validate(sendMessageSchema), async (req, res, next) => {
  try {
    const { to, message } = req.body;

    const im = imessage(spectrum);
    const user = await im.user(to);
    const space = await im.space(user);
    await space.send(message);

    res.json({ status: "sent", to });
  } catch (err) {
    next(err);
  }
});

export default router;
