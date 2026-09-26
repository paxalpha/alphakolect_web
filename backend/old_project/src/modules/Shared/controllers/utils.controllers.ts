import type { Request, Response, NextFunction } from "express";
import BaseController from "../../../controller/base.controller";
import { createCustomError } from "../../../errors/customError";
import { StatusCodes } from "http-status-codes";
import { IUtilityService } from "../services/utils.service";

export class UtilityController extends BaseController {
	private utilityService: IUtilityService;
	constructor(utilityService: IUtilityService) {
		super();
		this.utilityService = utilityService;
	}

	getCurrenciesController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const merchantAccount = await this.utilityService.getAllCurrencies();
			this.successResponse(res, "Currrencies retrieved successfully", merchantAccount, StatusCodes.CREATED);
		} catch (error) {
			console.log(error);
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};
}
