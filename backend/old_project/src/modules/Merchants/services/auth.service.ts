import { StatusCodes } from "http-status-codes";
import { createCustomError } from "../../../errors/customError";
import { PrismaClient } from "@prisma/client";
import type { TMerchantDTO, TMerchantLoginDTO, TMerchantPasswordRecoveryDTO, TMerchantWithAccesstoken, TSafeMerchantDTO } from "../../../dtos/merchant.dto";
import type { TAgentDTO, TSafeAgentDTO } from "../../../dtos/agent.dto";
import { compareHashedSting, hashString } from "../../../utils/helpers";
import { generateAccessToken, TokenTypes } from "../../../utils/helpers/token";
import config from "../../../config/config";
import { IMailService, MailService } from "../../../utils/mail/mailer";

export interface IMerchantAuthService {
	createAccount(payload: TMerchantDTO): Promise<TSafeMerchantDTO>;
	createAgentAccount(payload: TAgentDTO): Promise<TSafeAgentDTO>;
	getAllAgents(page?: number, pageSize?: number): Promise<{ agents: TSafeAgentDTO[]; total: number }>;
	updateAgent(agentId: string, updates: Partial<{ name: string; email: string; phoneNumber: string; password: string }>): Promise<TSafeAgentDTO>;
	disableAgent(agentId: string): Promise<void>;
	enableAgent(agentId: string): Promise<void>;
	completeAccountVerification(id: string): Promise<TSafeMerchantDTO>;
	login(payload: TMerchantLoginDTO): Promise<TMerchantWithAccesstoken>;
	initiateForgotPassword(email: string): Promise<void>;
	resetPassword(payload: TMerchantPasswordRecoveryDTO): Promise<TMerchantWithAccesstoken>;
}
export class MerchantAuthService implements IMerchantAuthService {
	private prisma: PrismaClient;
	private mailService: IMailService;
	private year: string;

	constructor() {
		this.prisma = new PrismaClient();
		this.mailService = new MailService();
		this.year = new Date().getFullYear().toString();
	}

	public async createAccount(payload: TMerchantDTO): Promise<TSafeMerchantDTO> {
		try {
			const existingMerchant = await this.prisma.merchant.findFirst({
				where: {
					OR: [{ email: payload.email }, { phone: payload.phone }],
				},
			});
			if (existingMerchant) {
				if (!existingMerchant.accountIsVerified) {
					const verificationToken = generateAccessToken({ id: existingMerchant.id, type: TokenTypes.AUTH_ONBOARDING }, 30);
					const verificationLink = `${config.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
					const mailContext = { merchantName: existingMerchant.businessName, verificationLink, year: this.year };
					this.mailService.sendMail({ to: existingMerchant.email, template: "merchant-email-verification", subject: "Account Email Verification", context: mailContext });
					throw createCustomError("Sorry, this merchant already exists, but is yet to be verified, we just your verification link to your mail", StatusCodes.BAD_REQUEST);
				}
				throw createCustomError("Sorry, this merchant already exists", StatusCodes.BAD_REQUEST);
			}
			const hashedPassword = hashString(payload.password);
			const { password, ...merchant } = await this.prisma.merchant.create({
				data: {
					...payload,
					password: hashedPassword,
				},
			});
			const verificationToken = generateAccessToken({ id: merchant.id, type: TokenTypes.AUTH_ONBOARDING }, 30);
			const verificationLink = `${config.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
			const mailContext = { merchantName: payload.businessName, verificationLink, year: this.year };
			this.mailService.sendMail({ to: payload.email, template: "merchant-email-verification", subject: "Account Email Verification", context: mailContext });
			return merchant;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async completeAccountVerification(id: string): Promise<any> {
		try {
			const merchant = await this.prisma.merchant.findUnique({
				where: {
					id,
				},
			});
			if (!merchant) throw createCustomError("Invalid merchant credential", StatusCodes.BAD_REQUEST);
			const updatedMerchant = await this.prisma.merchant.update({
				where: {
					id,
				},
				data: {
					accountIsVerified: true,
				},
			});
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async login(payload: TMerchantLoginDTO): Promise<TMerchantWithAccesstoken> {
		try {
			const merchant = await this.prisma.merchant.findUnique({
				where: {
					email: payload.email,
				},
				include: {
					baseCurrency: true,
				},
			});
			if (!merchant) throw createCustomError("Invalid merchant credential", StatusCodes.BAD_REQUEST);
			if (!merchant.accountIsVerified) {
				const verificationToken = generateAccessToken({ id: merchant.id, type: TokenTypes.AUTH_ONBOARDING }, 30);
				const verificationLink = `${config.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
				const mailContext = { merchantName: merchant.businessName, verificationLink, year: this.year };
				this.mailService.sendMail({ to: merchant.email, template: "merchant-email-verification", subject: "Account Email Verification", context: mailContext });
				throw createCustomError("Sorry, this merchant already exists, but is yet to be verified, we just your verification link to your mail", StatusCodes.BAD_REQUEST);
			}
			if (!merchant.isActive) throw createCustomError("Sorry, this account has been temporarily deactivated, kindly reach out to the admin to activate your account", StatusCodes.BAD_REQUEST);
			if (!compareHashedSting(payload.password, merchant.password)) throw createCustomError("Invalid merchant credential", StatusCodes.BAD_REQUEST);
			const accessToken = generateAccessToken({ id: merchant.id, type: TokenTypes.MERCHANT_LOGIN }, config.NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);
			const { password, isActive, accountIsVerified, ...safeMerchantData } = merchant;
			return { ...safeMerchantData, accessToken };
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async initiateForgotPassword(email: string): Promise<void> {
		try {
			const merchant = await this.prisma.merchant.findUnique({
				where: {
					email,
				},
			});
			if (!merchant) throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			if (!merchant.accountIsVerified) throw createCustomError("Merchant account is not verified", StatusCodes.BAD_REQUEST);
			if (!merchant.isActive) throw createCustomError("Merchant account is not active", StatusCodes.BAD_REQUEST);
			const verificationToken = generateAccessToken({ id: merchant.id, type: TokenTypes.AUTH_FORGOT_PASSWORD }, 30);
			const verificationLink = `${config.FRONTEND_URL}/auth/forgot-password?token=${verificationToken}`;
			const mailContext = { merchantName: merchant.businessName, verificationLink, year: this.year };
			this.mailService.sendMail({ to: merchant.email, template: "merchant-forgot-password", subject: "Password Recovery Confirmation", context: mailContext });
			return;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async resetPassword(payload: TMerchantPasswordRecoveryDTO): Promise<any> {
		try {
			const merchant = await this.prisma.merchant.findUnique({
				where: {
					id: payload.id,
				},
			});
			if (!merchant) throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			const hashedPassword = hashString(payload.password);
			const { password, isActive, accountIsVerified, ...updatedMerchant } = await this.prisma.merchant.update({
				where: {
					id: payload.id,
				},
				data: {
					password: hashedPassword,
				},
				include: {
					baseCurrency: true,
				},
			});
			const accessToken = generateAccessToken({ id: updatedMerchant.id, type: TokenTypes.AUTH_LOGIN }, config.NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);
			return { ...updatedMerchant, accessToken };
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async createAgentAccount(payload: TAgentDTO): Promise<TSafeAgentDTO> {
		try {
			const existingAgent = await this.prisma.agent.findUnique({
			where: { email: payload.email },
			});
		
			if (existingAgent) {
			throw createCustomError("Sorry, this agent already exists", StatusCodes.BAD_REQUEST);
			}
		
			if (payload.phoneNumber) {
			const existingAgentByPhone = await this.prisma.agent.findUnique({
				where: { phoneNumber: payload.phoneNumber },
			});
		
			if (existingAgentByPhone) {
				throw createCustomError("Phone number already in use", StatusCodes.BAD_REQUEST);
			}
			}
		
			const hashedPassword = hashString(payload.password);
		
			const createdAgent = await this.prisma.agent.create({
			data: {
				...payload,
				password: hashedPassword,
				phoneNumber: payload.phoneNumber ?? null,
			},
			});
		
			const verificationToken = generateAccessToken(
			{ id: createdAgent.id, type: TokenTypes.AUTH_ONBOARDING },
			30
			);
			const verificationLink = `${config.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
		
			const mailContext = {
			agentName: payload.name,
			verificationLink,
			year: this.year,
			};
		
			this.mailService.sendMail({
			to: payload.email,
			template: "agent-email-verification",
			subject: "Account Email Verification",
			context: mailContext,
			});
		
			return { ...createdAgent, phoneNumber: createdAgent.phoneNumber };
		} catch (error: any) {
			if (error.code === 'P2002') {
			throw createCustomError("A record with a unique field already exists.", StatusCodes.CONFLICT);
			}
			throw createCustomError(error.message, StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async getAllAgents(page: number = 1, pageSize: number = 10): Promise<{ agents: TSafeAgentDTO[], total: number }> {
		try {
			const skip = (page - 1) * pageSize;
			const take = pageSize;

			const [agents, total] = await Promise.all([
				this.prisma.agent.findMany({
					select: {
						id: true,
						name: true,
						email: true,
						phoneNumber: true,
						isActive: true,
						createdAt: true,
						updatedAt: true,
					},
					skip,
					take,
					orderBy: { createdAt: "desc" },
				}),
				this.prisma.agent.count()
			]);
	
			return { agents, total };
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async updateAgent(agentId: string, updates: Partial<{ name: string, email: string, phoneNumber: string, password: string }>): Promise<TSafeAgentDTO> {
		try {
			const existingAgent = await this.prisma.agent.findUnique({ where: { id: agentId } });
			if (!existingAgent) throw createCustomError("Agent not found", StatusCodes.NOT_FOUND);
	
			let hashedPassword: string | undefined = undefined;
	
			if (updates.password) {
				hashedPassword = await hashString(updates.password);
			}
	
			const updatedAgent = await this.prisma.agent.update({
				where: { id: agentId },
				data: {
					name: updates.name,
					email: updates.email,
					phoneNumber: updates.phoneNumber,
					password: hashedPassword,
				},
				select: {
					id: true,
					name: true,
					email: true,
					phoneNumber: true,
					isActive: true,
					createdAt: true,
					updatedAt: true,
				},
			});
	
			return updatedAgent;
		} catch (error) {
			throw createCustomError(error.message, StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async disableAgent(agentId: string): Promise<void> {
		try {
			const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
			if (!agent) throw createCustomError("Agent not found", StatusCodes.NOT_FOUND);
	
			await this.prisma.agent.update({
				where: { id: agentId },
				data: { isActive: false },
			});
		} catch (error) {
			throw createCustomError(error.message, StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async enableAgent(agentId: string): Promise<void> {
		try {
			const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
			if (!agent) throw createCustomError("Agent not found", StatusCodes.NOT_FOUND);
	
			await this.prisma.agent.update({
				where: { id: agentId },
				data: { isActive: true },
			});
		} catch (error) {
			throw createCustomError(error.message, StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}
}
