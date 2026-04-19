import { Router } from "express";
import sendMessage from "./send-message.js";
import linkSession from "./link-session.js";

const router = Router();

router.use("/send-message", sendMessage);
router.use("/link-session", linkSession);

export default router;
