import { Request, Response, NextFunction, RequestHandler } from "express";

const asyncWrapper = (cb: RequestHandler): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			await cb(req, res, next);
		} catch (error) {
			next(error);
		}
	};
};

export default asyncWrapper;
