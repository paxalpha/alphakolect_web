import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { errorResponse } from "../../utils/helpers/responseTraits";
import { CustomAPIError } from "../../errors/customError";

export const advancedErrorHandlerMiddleware: ErrorRequestHandler = (err: CustomAPIError | Error, _: Request, res: Response, __: NextFunction) => {
	if (err instanceof CustomAPIError) {
		res.status(err.code).json(
			errorResponse({
				message: err.message,
				statusCode: err.code,
				data: null,
			}),
		);
	} else {
		res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
			errorResponse({
				message: "Something went wrong,please try again later.",
				statusCode: 500,
				data: null,
			}),
		);
	}
};
