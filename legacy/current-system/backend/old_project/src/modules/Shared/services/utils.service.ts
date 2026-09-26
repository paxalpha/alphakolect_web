import { PrismaClient } from "@prisma/client";
import { TCurrencyDTO } from "../../../dtos/utils.dto";

export interface IUtilityService {
	getAllCurrencies(): Promise<TCurrencyDTO[]>;
}
export class UtilityService implements IUtilityService {
	private prisma: PrismaClient;

	constructor() {
		this.prisma = new PrismaClient();
	}

	public async getAllCurrencies(): Promise<TCurrencyDTO[]> {
		const currencies = await this.prisma.currency.findMany();
		return currencies;
	}
}
