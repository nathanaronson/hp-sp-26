import { Router } from "express";
import health from "./health.js";
import sendMessage from "./send-message.js"

const router = Router();

router.use("/health", health);
router.use("/send-message", sendMessage);

export default router;
