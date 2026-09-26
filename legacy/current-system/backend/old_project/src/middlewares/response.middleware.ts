import type { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import type { IResponse } from "../types/express";
import { successResponse } from "../utils/helpers/responseTraits";

/**
 * Use the custom response middleware to extend express response object.
 */
export const response = (req: Request, res: Response, next: NextFunction) => {
	res.success = function (statusCode: number, message: string, data: Record<string, any> | null): Response<IResponse> {
		return this.status(statusCode).json(
			successResponse({
				statusCode: statusCode,
				message: message,
				data: data,
			}),
		);
	};

	next();
};
