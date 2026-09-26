import nodemailer from "nodemailer";
import config from "../../config/config";
import { MailOptions } from "nodemailer/lib/smtp-transport";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";

export interface TMailOptions extends MailOptions {
	template: string;
	context: Record<string, string | string[]>;
}

export interface IMailService {
	sendMail(mailOptions: TMailOptions): Promise<void>;
}

export class MailService implements IMailService {
	private transporter: nodemailer.Transporter;
	private templatesDir: string;

	constructor() {
		this.transporter = nodemailer.createTransport({
			host: config.MAIL_HOST,
			port: config.MAIL_PORT,
			secure: true,
			auth: {
				user: config.MAIL_ACCOUNT_USER,
				pass: config.MAIL_ACCOUNT_PASSWORD,
			},
		});

		this.templatesDir = path.resolve(__dirname, "../../utils/mail/templates");
	}

	private async compileTemplate(templateName: string, context: Record<string, string | string[]>): Promise<string> {
		const templatePath = path.join(this.templatesDir, `${templateName}.handlebars`);
		const templateSource = fs.readFileSync(templatePath, "utf8");
		const template = handlebars.compile(templateSource);
		return template(context);
	}

	private async sendOutMail(mailOptions: MailOptions): Promise<void> {
		return new Promise((resolve, reject) => {
			this.transporter.sendMail(mailOptions, (err: any, info: any) => {
				if (err) {
					reject(err);
				} else {
					resolve(info);
				}
			});
		});
	}

	public async sendMail(mailOptions: TMailOptions): Promise<void> {
		try {
			// Compile the template with the provided context
			const html = await this.compileTemplate(mailOptions.template, mailOptions.context);

			const options = {
				from: mailOptions.from ?? `Admin From Alphakolect <${config.MAIL_ACCOUNT_USER}>`,
				to: mailOptions.to,
				subject: mailOptions.subject,
				attachments: mailOptions.attachments,
				html: html,
			};

			await this.sendOutMail(options);
		} catch (error) {
			console.error("Error sending mail:", error);
			throw error;
		}
	}
}
