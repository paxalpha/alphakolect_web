import { z } from "zod";

export const merchantLoginValidationSchema = z.object({
	email: z.string().trim().email(),
	password: z.string(),
});

export const merchantSignUpValidationSchema = z.object({
	email: z.string().trim().email(),
	password: z.string().refine(
		(password) => {
			// At least one uppercase letter, one lowercase letter, one special character, and one digit
			const uppercaseRegex = /[A-Z]/;
			const lowercaseRegex = /[a-z]/;
			const specialCharacterRegex = /[!@#$%^&*(),.?":{}|<>]/;
			const digitRegex = /\d/;

			return password.length >= 8 && uppercaseRegex.test(password) && lowercaseRegex.test(password) && specialCharacterRegex.test(password) && digitRegex.test(password);
		},
		{
			message: "required to have at least 8 characters long and must have at least one uppercase letter, one lowercase letter, one special character, and one digit",
		},
	),
	businessName: z.string().trim().min(2),
	businessAlias: z.string().trim().min(2),
	phone: z.string().trim().min(11),
	baseCurrency: z.string().trim().uuid(),
});

export const merchantInitiateForgotPassword = z.object({
	email: z.string().trim().email(),
});

export const merchantPasswordRecoveryValidationSchema = z.object({
	password: z.string().refine(
		(password) => {
			// At least one uppercase letter, one lowercase letter, one special character, and one digit
			const uppercaseRegex = /[A-Z]/;
			const lowercaseRegex = /[a-z]/;
			const specialCharacterRegex = /[!@#$%^&*(),.?":{}|<>]/;
			const digitRegex = /\d/;

			return password.length >= 8 && uppercaseRegex.test(password) && lowercaseRegex.test(password) && specialCharacterRegex.test(password) && digitRegex.test(password);
		},
		{
			message: "required to have at least 8 characters long and must have at least one uppercase letter, one lowercase letter, one special character, and one digit",
		},
	),
});
