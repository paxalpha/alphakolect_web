import { StatusCodes } from "http-status-codes";
import type { Request, Response } from "express";

export default class BaseController {
	public successResponse = (res: Response, message: string, data: Record<string, any> | null, status = StatusCodes.OK) => {
		res.success(status, message, data);
	};

	// This is an alternative pagination query, which is not efficient enough(as it manipulates all fetched data before serving) compared to the diract database pagination
	public paginateQueryLogic(responseData: Record<string, any>[], req: Request) {
		const page = req.query.page ? Number(req.query.page) : 1;
		const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 10;

		const totalItems = responseData.length;
		const totalPages = Math.ceil(totalItems / pageSize);

		const startIndex = (page - 1) * pageSize;
		const endIndex = page * pageSize;

		const paginatedItems = responseData.slice(startIndex, endIndex);

		const paginationInfo = {
			totalItems,
			totalPages,
			currentPage: Number(page),
		};

		return {
			paginatedItems,
			meta: paginationInfo,
		};
	}
}
