import { StatusCodes } from "http-status-codes";
import { createCustomError } from "../../../errors/customError";
import { PrismaClient } from "@prisma/client";
import type { TAdminDTO, TAdminLoginDTO, TAdminPasswordRecoveryDTO, TAdminWithAccesstoken, TSafeAdminDTO } from "../../../dtos/admin.dto";
import { compareHashedSting, hashString } from "../../../utils/helpers";
import { generateAccessToken, TokenTypes } from "../../../utils/helpers/token";
import config from "../../../config/config";
import { IMailService, MailService } from "../../../utils/mail/mailer";
import { generateStrongPassword } from "../../../utils/validation.schemas/admin/auth.schema";

export interface IAdminAuthService {
	createAccount(payload: TAdminDTO): Promise<TSafeAdminDTO>;
	login(payload: TAdminLoginDTO): Promise<TAdminWithAccesstoken>;
	initiateForgotPassword(email: string): Promise<void>;
	resetPassword(payload: TAdminPasswordRecoveryDTO): Promise<TAdminWithAccesstoken>;
}

export class AdminAuthService implements IAdminAuthService {
	private prisma: PrismaClient;
	private mailService: IMailService;
	private year: string;

	constructor() {
		this.prisma = new PrismaClient();
		this.mailService = new MailService();
		this.year = new Date().getFullYear().toString();
	}

	public async createAccount(payload: TAdminDTO): Promise<TSafeAdminDTO> {
		try {
			const existingAdmin = await this.prisma.systemAdmin.findUnique({
				where: { email: payload.email },
			});

			if (existingAdmin) {
				throw createCustomError("Admin with this email already exists", StatusCodes.BAD_REQUEST);
			}

			const plainPassword = generateStrongPassword();
			const hashedPassword = hashString(plainPassword);

			const data = {
				email: payload.email,
				password: hashedPassword,
				isActive: true,
				profileImageUrl: payload.profileImageUrl,
			};

			const { password, ...admin } = await this.prisma.systemAdmin.create({
				data,
			});

			const mailContext = {
				adminEmail: admin.email,
				adminPassword: plainPassword,
				year: this.year,
			};

			this.mailService.sendMail({
				to: admin.email,
				template: "admin-login-credentials",
				subject: "Admin Account Credentials",
				context: mailContext,
			});

			return admin;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async login(payload: TAdminLoginDTO): Promise<TAdminWithAccesstoken> {
		try {
			const admin = await this.prisma.systemAdmin.findUnique({
				where: { email: payload.email },
			});

			if (!admin) {
				throw createCustomError("Invalid admin credentials", StatusCodes.BAD_REQUEST);
			}

			if (!admin.isActive) {
				throw createCustomError("Admin account is deactivated", StatusCodes.BAD_REQUEST);
			}

			const isPasswordValid = compareHashedSting(payload.password, admin.password);
			if (!isPasswordValid) {
				throw createCustomError("Invalid admin credentials", StatusCodes.BAD_REQUEST);
			}

			const accessToken = generateAccessToken({ id: admin.id, type: TokenTypes.ADMIN_LOGIN }, config.ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);

			const { password, ...safeAdmin } = admin;

			// Convert the Date fields to strings (ISO format)
			const adminWithAccessToken: TAdminWithAccesstoken = {
				...safeAdmin,
				accessToken,
				createdAt: admin.createdAt,
				updatedAt: admin.updatedAt,
			};

			return adminWithAccessToken;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async initiateForgotPassword(email: string): Promise<void> {
		try {
			const admin = await this.prisma.systemAdmin.findUnique({
				where: { email },
			});

			if (!admin) {
				throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			}

			if (!admin.isActive) {
				throw createCustomError("Admin account is deactivated", StatusCodes.BAD_REQUEST);
			}

			const token = generateAccessToken({ id: admin.id, type: TokenTypes.AUTH_FORGOT_PASSWORD }, 30);

			const resetLink = `${config.FRONTEND_URL}/auth/forgot-password?token=${token}`;

			const mailContext = {
				verificationLink: resetLink,
				year: this.year,
			};

			this.mailService.sendMail({
				to: admin.email,
				subject: "Password Recovery",
				template: "admin-forgot-password",
				context: mailContext,
			});
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async resetPassword(payload: TAdminPasswordRecoveryDTO): Promise<TAdminWithAccesstoken> {
		try {
			const admin = await this.prisma.systemAdmin.findUnique({
				where: { id: payload.id },
			});

			if (!admin) {
				throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			}

			const hashedPassword = hashString(payload.password);

			const { password, ...updatedAdmin } = await this.prisma.systemAdmin.update({
				where: { id: payload.id },
				data: { password: hashedPassword },
			});

			const accessToken = generateAccessToken({ id: updatedAdmin.id, type: TokenTypes.AUTH_LOGIN }, config.NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);

			// Convert Date to string for createdAt and updatedAt
			const updatedAdminWithAccessToken: TAdminWithAccesstoken = {
				...updatedAdmin,
				accessToken,
				createdAt: updatedAdmin.createdAt,
				updatedAt: updatedAdmin.updatedAt,
			};

			return updatedAdminWithAccessToken;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}
}
