import { StatusCodes } from "http-status-codes";
import { createCustomError } from "../../../errors/customError";
import { PrismaClient } from "@prisma/client";
import type { TAgentDTO, TAgentLoginDTO, TAgentPasswordRecoveryDTO, TAgentWithAccesstoken, TSafeAgentDTO } from "../../../dtos/agent.dto";
import { compareHashedSting, hashString } from "../../../utils/helpers";
import { generateAccessToken, TokenTypes } from "../../../utils/helpers/token";
import config from "../../../config/config";
import { IMailService, MailService } from "../../../utils/mail/mailer";

export interface IAgentAuthService {
	login(payload: TAgentLoginDTO): Promise<TAgentWithAccesstoken>;
	initiateForgotPassword(email: string): Promise<void>;
	resetPassword(payload: TAgentPasswordRecoveryDTO): Promise<TAgentWithAccesstoken>;
}
export class AgentAuthService implements IAgentAuthService {
	private prisma: PrismaClient;
	private mailService: IMailService;
	private year: string;

	constructor() {
		this.prisma = new PrismaClient();
		this.mailService = new MailService();
		this.year = new Date().getFullYear().toString();
	}

	public async login(payload: TAgentLoginDTO): Promise<TAgentWithAccesstoken> {
		try {
			const agent = await this.prisma.agent.findUnique({
				where: { email: payload.email },
			});

			if (!agent) {
				throw createCustomError("Invalid agent credentials", StatusCodes.BAD_REQUEST);
			}

			if (!agent.isActive) {
				throw createCustomError("Agent account is deactivated", StatusCodes.BAD_REQUEST);
			}

			const isPasswordValid = compareHashedSting(payload.password, agent.password);
			if (!isPasswordValid) {
				throw createCustomError("Invalid agent credentials", StatusCodes.BAD_REQUEST);
			}

			const accessToken = generateAccessToken({ id: agent.id, type: TokenTypes.MERCHANT_LOGIN }, config.ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);

			const { password, ...safeAgent } = agent;

			// Convert the Date fields to strings (ISO format)
			const agentWithAccessToken: TAgentWithAccesstoken = {
				...safeAgent,
				accessToken,
				createdAt: agent.createdAt,
				updatedAt: agent.updatedAt,
			};

			return agentWithAccessToken;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async initiateForgotPassword(email: string): Promise<void> {
		try {
			const agent = await this.prisma.agent.findUnique({
				where: { email },
			});

			if (!agent) {
				throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			}

			if (!agent.isActive) {
				throw createCustomError("agent account is deactivated", StatusCodes.BAD_REQUEST);
			}

			const token = generateAccessToken({ id: agent.id, type: TokenTypes.AUTH_FORGOT_PASSWORD }, 30);

			const resetLink = `${config.FRONTEND_URL}/auth/forgot-password?token=${token}`;

			const mailContext = {
				verificationLink: resetLink,
				year: this.year,
			};

			this.mailService.sendMail({
				to: agent.email,
				subject: "Password Recovery",
				template: "agent-forgot-password",
				context: mailContext,
			});
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}

	public async resetPassword(payload: TAgentPasswordRecoveryDTO): Promise<TAgentWithAccesstoken> {
		try {
			const agent = await this.prisma.agent.findUnique({
				where: { id: payload.id },
			});

			if (!agent) {
				throw createCustomError("No matching account found", StatusCodes.BAD_REQUEST);
			}

			const hashedPassword = hashString(payload.password);

			const { password, ...updatedAgent } = await this.prisma.agent.update({
				where: { id: payload.id },
				data: { password: hashedPassword },
			});

			const accessToken = generateAccessToken({ id: updatedAgent.id, type: TokenTypes.AUTH_LOGIN }, config.NON_ADMIN_USERS_LOGIN_TOKEN_EXPIRY_TIME);

			// Convert Date to string for createdAt and updatedAt
			const updatedAgentWithAccessToken: TAgentWithAccesstoken = {
				...updatedAgent,
				accessToken,
				createdAt: updatedAgent.createdAt,
				updatedAt: updatedAgent.updatedAt,
			};

			return updatedAgentWithAccessToken;
		} catch (error) {
			throw createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR);
		}
	}
}
