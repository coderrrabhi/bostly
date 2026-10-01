import express, { type Express } from "express";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// JSON payloads for the order and schedule pages run to hundreds of kilobytes;
// mounted after the Clerk proxy so upstream responses are passed through untouched.
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.set("trust proxy", 1);

app.use("/api", router);

export default app;
