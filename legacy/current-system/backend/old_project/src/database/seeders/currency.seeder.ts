import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const availbaleCurrencies = [
	{
		name: "US Dollar",
		code: "USD",
		symbol: "$",
	},
	{
		name: "Euro",
		code: "EUR",
		symbol: "€",
	},
	{
		name: "British Pound",
		code: "GBP",
		symbol: "£",
	},
	{
		name: "Japanese Yen",
		code: "JPY",
		symbol: "¥",
	},
	{
		name: "Canadian Dollar",
		code: "CAD",
		symbol: "$",
	},
	{
		name: "Australian Dollar",
		code: "AUD",
		symbol: "$",
	},
	{
		name: "Swiss Franc",
		code: "CHF",
		symbol: "CHF",
	},
	{
		name: "Chinese Yuan",
		code: "CNY",
		symbol: "¥",
	},
	{
		name: "Indian Rupee",
		code: "INR",
		symbol: "₹",
	},
	{
		name: "South African Rand",
		code: "ZAR",
		symbol: "R",
	},
	{
		name: "Brazilian Real",
		code: "BRL",
		symbol: "R$",
	},
	{
		name: "Russian Ruble",
		code: "RUB",
		symbol: "₽",
	},
	{
		name: "Mexican Peso",
		code: "MXN",
		symbol: "$",
	},
	{
		name: "South Korean Won",
		code: "KRW",
		symbol: "₩",
	},
	{
		name: "Singapore Dollar",
		code: "SGD",
		symbol: "$",
	},
	{
		name: "Swedish Krona",
		code: "SEK",
		symbol: "kr",
	},
	{
		name: "Norwegian Krone",
		code: "NOK",
		symbol: "kr",
	},
	{
		name: "Danish Krone",
		code: "DKK",
		symbol: "kr",
	},
	{
		name: "New Zealand Dollar",
		code: "NZD",
		symbol: "$",
	},
	{
		name: "Nigerian Naira",
		code: "NGN",
		symbol: "₦",
	},
	{
		name: "Turkish Lira",
		code: "TRY",
		symbol: "₺",
	},
];

export const seedCurrency = async () => {
	try {
		const currencies = await prisma.currency.createManyAndReturn({
			data: availbaleCurrencies,
			skipDuplicates: true,
		});
		console.log("Added", currencies);
	} catch (error) {
		console.log(error);
	}
};
