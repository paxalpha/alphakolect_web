import { z } from "zod";


export const adminLoginValidationSchema = z.object({
	email: z.string().trim().email(),
	password: z.string(),
});

export const adminSignUpValidationSchema = z.object({
	email: z.string().trim().email(),
	phone: z.string().trim().min(11), 
});


export const adminInitiateForgotPassword = z.object({
	email: z.string().trim().email(),
});


export const adminPasswordRecoveryValidationSchema = z.object({
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
			message: "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one special character, and one digit.",
		},
	),
});

export const generateStrongPassword = (length = 12): string => {
	const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const lower = "abcdefghijklmnopqrstuvwxyz";
	const digits = "0123456789";
	const symbols = "!@#$%^&*()_+{}[]|:;<>,.?/~";

	const all = upper + lower + digits + symbols;

	let password = "";
	password += upper[Math.floor(Math.random() * upper.length)];
	password += lower[Math.floor(Math.random() * lower.length)];
	password += digits[Math.floor(Math.random() * digits.length)];
	password += symbols[Math.floor(Math.random() * symbols.length)];

	// Fill the rest of the password
	for (let i = 4; i < length; i++) {
		password += all[Math.floor(Math.random() * all.length)];
	}

	// Shuffle the characters
	return password
		.split("")
		.sort(() => 0.5 - Math.random())
		.join("");
};
