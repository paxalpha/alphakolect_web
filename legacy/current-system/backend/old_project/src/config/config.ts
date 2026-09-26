import dotenv from "dotenv";
dotenv.config();

interface Config {
	API_PREFIX: string;
	JWT_SECRET?: string;
	DATABASE_URL: string;
	NODE_ENV: string;
	APP_PORT: string | number;
	NON_ADMIN_USERS_LIMIT_REQUEST_PER_MINUTE: string;
	NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME: string | number;
	ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME: string | number;
	MAIL_HOST: string;
	MAIL_PORT: number;
	MAIL_ACCOUNT_USER: string;
	MAIL_ACCOUNT_PASSWORD: string;
	FRONTEND_URL: string;
}

const config: Config = {
	DATABASE_URL: process.env.DATABASE_URL as string,
	NODE_ENV: process.env.NODE_ENV || "development",
	APP_PORT: process.env.APP_PORT || 4000,
	NON_ADMIN_USERS_LIMIT_REQUEST_PER_MINUTE: process.env.NON_ADMIN_USERS_LIMIT_REQUEST_PER_MINUTE || "20",
	API_PREFIX: process.env.API_PREFIX || "/api/v1",
	JWT_SECRET: process.env.JWT_SECRET,
	NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME: process.env.NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME || 1,
	ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME: process.env.ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME || 1,
	MAIL_HOST: process.env.MAIL_HOST!,
	MAIL_PORT: Number(process.env.MAIL_PORT),
	MAIL_ACCOUNT_USER: process.env.MAIL_ACCOUNT_USER!,
	MAIL_ACCOUNT_PASSWORD: process.env.MAIL_ACCOUNT_PASSWORD!,
	FRONTEND_URL: process.env.FRONTEND_URL!,
};

export default config;
