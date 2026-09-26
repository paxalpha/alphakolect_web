import rateLimiter from "express-rate-limit";
import config from "../config/config";
import { StatusCodes } from "http-status-codes";
import { errorResponse } from "../utils/helpers/responseTraits";
const apiLimiter = rateLimiter({
	windowMs: 1 * 60 * 1000,
	max: Number.parseInt(config.NON_ADMIN_USERS_LIMIT_REQUEST_PER_MINUTE),
	statusCode: StatusCodes.TOO_MANY_REQUESTS,
	message: () => {
		return errorResponse({
			data: null,
			message: "You are performing too many request on this route,please try again later",
			statusCode: StatusCodes.TOO_MANY_REQUESTS,
		});
	},
});

export default apiLimiter;
