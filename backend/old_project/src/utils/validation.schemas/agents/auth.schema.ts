import { z } from "zod";

export const agentLoginValidationSchema = z.object({
    email: z.string().trim().email(),
    password: z.string(),
});

export const agentSignUpValidationSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long"),
    email: z.string().trim().email("Invalid email format"),
    password: z
      .string()
      .refine(
        (password) => {
          const uppercase = /[A-Z]/;
          const lowercase = /[a-z]/;
          const special = /[!@#$%^&*(),.?":{}|<>]/;
          const digit = /\d/;
  
          return (
            password.length >= 8 &&
            uppercase.test(password) &&
            lowercase.test(password) &&
            special.test(password) &&
            digit.test(password)
          );
        },
        {
          message:
            "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character",
        }
      ),
    phoneNumber: z.string().trim().min(11)
});

export const agentUpdateValidationSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long").optional(),
    email: z.string().trim().email("Invalid email format").optional(),
    password: z
      .string()
      .refine(
        (password) => {
          const uppercase = /[A-Z]/;
          const lowercase = /[a-z]/;
          const special = /[!@#$%^&*(),.?":{}|<>]/;
          const digit = /\d/;
  
          return (
            password.length >= 8 &&
            uppercase.test(password) &&
            lowercase.test(password) &&
            special.test(password) &&
            digit.test(password)
          );
        },
        {
          message:
            "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character",
        }
      ).optional(),
    phoneNumber: z.string().trim().min(11).optional()
});

export const agentInitiateForgotPassword = z.object({
    email: z.string().trim().email(),
});

export const agentPasswordRecoveryValidationSchema = z.object({
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
