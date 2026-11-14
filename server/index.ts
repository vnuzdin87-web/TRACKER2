import { z } from "zod";
import { app } from "./app.js";

const config = z
  .object({
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  })
  .parse(process.env);

app.listen(config.PORT, config.HOST, () => {
  console.log(`Сервер запущен: http://${config.HOST}:${config.PORT}`);
});
