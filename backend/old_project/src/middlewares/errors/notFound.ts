import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { errorResponse } from "../../utils/helpers/responseTraits";

export const notFound: RequestHandler = (req: Request, res: Response) => {
	res.status(StatusCodes.NOT_FOUND).json(
		errorResponse({
			statusCode: 404,
			message: "This path exists somewhere in space time but not here",
			data: null,
		}),
	);
};
