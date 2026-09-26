import express from "express";
import cors from "cors";
import routes from "./routes";
import bodyParser from "body-parser";
import { notFound } from "./middlewares/errors/notFound";
import config from "./config/config";
import { advancedErrorHandlerMiddleware } from "./middlewares/errors/errorHandler";
import helmet from "helmet";
import { response } from "./middlewares/response.middleware";

const API_PREFIX = config.API_PREFIX;
const app = express();

app.use(express.json());
app.use(response);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
const corsOption = {
	origin: "*",
	credentials: true,
};

app.disable("x-powered-by");
app.use(helmet());
// app.use(xssClean())
app.use(cors(corsOption));
app.use(`/${API_PREFIX}`, routes);
app.use(notFound);
app.use(advancedErrorHandlerMiddleware);

export default app;
