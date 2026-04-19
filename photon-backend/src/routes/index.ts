import { Router } from "express";
import sendMessage from "./send-message.js"

const router = Router();

router.use("/send-message", sendMessage);

export default router;
