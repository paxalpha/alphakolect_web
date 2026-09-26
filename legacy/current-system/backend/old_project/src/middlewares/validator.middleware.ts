import type { Request, Response, NextFunction } from "express";
import { type z, ZodError } from "zod";
import { StatusCodes } from "http-status-codes";
import { errorResponse } from "../utils/helpers/responseTraits";

export function schemaValidator(schema: z.ZodObject<any, any> | z.ZodEffects<any, any>, validateQuery = false) {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			schema.parse(validateQuery ? req.query : req.body);
			next();
		} catch (error) {
			if (error instanceof ZodError) {
				const errorMessages = error.errors.map((issue: any) => ({
					message: `${issue.path.join(".")} is ${issue.message}`,
				}));
				res.status(StatusCodes.BAD_REQUEST).json(
					errorResponse({
						statusCode: StatusCodes.BAD_REQUEST,
						message: errorMessages[0].message,
						data: errorMessages,
					}),
				);
			} else {
				res.status(StatusCodes.UNPROCESSABLE_ENTITY).json(
					errorResponse({
						statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
						message: "Invalid data",
						data: error,
					}),
				);
			}
		}
	};
}
