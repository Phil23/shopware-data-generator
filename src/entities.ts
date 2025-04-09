import { z } from "zod";

export const ProductDefinition = z.object({
    name: z.string(),
    description: z.string(),
    price: z.number(),
    stock: z.number(),
});

export const PropertyOptionDefinition = z.object({
    name: z.string(),
    colorHexCode: z.string().optional(),
});

export const PropertyGroupDefinition = z.object({
    name: z.string(),
    description: z.string(),
    displayType: z.enum(["text", "color"]),
    options: z.array(PropertyOptionDefinition),
});

export const ProductReviewDefinition = z.object({
    externalUser: z.string(),
    externalEmail: z.string(),
    title: z.string(),
    content: z.string(),
    points: z.number().int(),
    status: z.boolean(),
});
