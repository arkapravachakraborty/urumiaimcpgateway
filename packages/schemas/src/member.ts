import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "MEMBER"]);

/**
 * Input for creating a new team member.
 */
export const CreateMemberInputSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: RoleSchema.default("MEMBER"),
});

export const AdminCreateMemberInputSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  role: RoleSchema.default("MEMBER"),
});

export const AdminCreateMemberOutputSchema = z.object({
  member: z.object({
    id: z.string(),
    email: z.string().email(),
    role: RoleSchema,
    createdAt: z.coerce.date(),
    disabledAt: z.coerce.date().nullable(),
  }),
  temporaryPassword: z.string().min(1),
});

/**
 * Input for updating a member.
 */
export const UpdateMemberInputSchema = z.object({
  email: z.string().email("Must be a valid email address").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: RoleSchema.optional(),
  disabled: z.boolean().optional(),
});

/**
 * Input for member login.
 */
export const LoginInputSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const LoginOutputSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: RoleSchema,
});

/**
 * Output representation of a member.
 * NEVER includes passwordHash.
 */
export const MemberOutputSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  createdAt: z.coerce.date(),
  disabledAt: z.coerce.date().nullable(),
});

export const MemberListOutputSchema = z.array(MemberOutputSchema);

export type Role = z.infer<typeof RoleSchema>;
export type CreateMemberInput = z.infer<typeof CreateMemberInputSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type MemberOutput = z.infer<typeof MemberOutputSchema>;
export type MemberListOutput = z.infer<typeof MemberListOutputSchema>;
