import app from "./app.js";
import { env } from "./config/env.js";
import { startMessageListener } from "./spectrum.js";

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  startMessageListener();
});
