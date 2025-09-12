import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ProductDefinition, ProductReviewDefinition, PropertyGroupDefinition } from "./entities.js";

export class DataGenerator {
    public readonly openAI: OpenAI;
    public readonly imageDir: string;

    constructor(openAiApiKey: string, imageDir = "./generatedImages") {
        if (!openAiApiKey.length || openAiApiKey.length <= 0) {
            console.error("Missing API key for OpenAI.");
        }

        this.openAI = new OpenAI({
            apiKey: openAiApiKey,
        });

        this.imageDir = imageDir;

        if (!fs.existsSync(this.imageDir)) {
            try {
                fs.mkdirSync(this.imageDir);
            } catch (err) {
                console.error(err);
            }
        }
    }

    async generatePropertyGroups(category: string, groupCount = 2) {
        console.log("Generating property group data ...");

        const prompt = `Create realistic sample data for ${groupCount} product property groups in JSON format 
                              that could describe the properties of products of the industry ${category}.`;

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4.1-2025-04-14",
            response_format: zodResponseFormat(
                z.object({
                    propertyGroups: z.array(PropertyGroupDefinition),
                }),
                "propertyGroups",
            ),
        });

        try {
            if (completion.choices[0]?.message.content) {
                const parsedResponse = JSON.parse(completion.choices[0].message.content);
                return parsedResponse["propertyGroups"];
            } else {
                return [];
            }
        } catch (e) {
            console.error(e);
        }
    }

    async generateProducts(
        category: string,
        productCount = 10,
        propertyGroups: Record<string, any> | null = null,
        generateImages = true,
        generateReviews = true,
        descriptionWordCount = 200,
        additionalInformation: string = "",
    ) {
        console.log(`Generating product data ...`);

        // Try fast path: generate distinct briefs in a single call, then fan-out product generation in parallel
        let products: Record<string, any>[] = [];
        try {
            const briefs = await this.generateProductBriefs(category, productCount, additionalInformation);

            if (Array.isArray(briefs) && briefs.length > 0) {
                products = await Promise.all(
                    briefs.map(async (brief) => {
                        return await this.generateProduct(
                            category,
                            propertyGroups,
                            generateReviews,
                            descriptionWordCount,
                            additionalInformation,
                            [],
                            brief,
                        );
                    }),
                );
            }
        } catch (err) {
            // fall back to sequential below
        }

        // Fallback: sequential with prior name awareness (slower but reliable)
        if (!products || products.length === 0) {
            products = [];
            for (let i = 0; i < productCount; i++) {
                const previousProductNames = products.map((p) => p.name).filter(Boolean);
                const product = await this.generateProduct(
                    category,
                    propertyGroups,
                    generateReviews,
                    descriptionWordCount,
                    additionalInformation,
                    previousProductNames,
                );

                if (product) {
                    products.push(product);
                }
            }
        }

        if (!generateImages) {
            return products;
        } else {
            return await this.generateProductImages(products, category, additionalInformation);
        }
    }

    async generateProduct(
        category: string,
        propertyGroups: Record<string, any> | null = null,
        generateReviews = true,
        descriptionWordCount = 200,
        additionalInformation: string = "",
        previousProductNames: string[] = [],
        brief: Record<string, any> | null = null,
    ) {
        let schema = ProductDefinition;

        let prompt = `Create realistic sample data for a product of an online store in JSON format. 
                      The product should resemble a realistic item of the industry ${category}, but not from real-world brands.
                      The product description should contain at least ${descriptionWordCount} words. You can use simple html to format the description.`;

        if (generateReviews) {
            schema = schema.extend({
                productReviews: z.array(ProductReviewDefinition),
            });

            prompt = `${prompt} The product should have at least five realistic reviews with points between 1 and 5.`;
        }

        if (propertyGroups) {
            const options: string[] = [];

            propertyGroups.forEach((group: Record<string, any>) => {
                group.options.forEach((option: Record<string, any>) => {
                    options.push(option.id);
                });
            });

            schema = schema.extend({
                options: z.array(
                    z.object({
                        id: z.enum(options as [string, ...string[]]),
                    }),
                ),
            });

            prompt = `${prompt} The product should have at least two fitting options from the possible options.`;
        }

        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Consider the following additional context for the product and its description: \"${additionalInformation}\".`;
        }

        if (previousProductNames && previousProductNames.length > 0) {
            const previousList = previousProductNames.map((n) => `\"${n}\"`).join(", ");
            prompt = `${prompt} IMPORTANT: Avoid creating a product that is too similar to any of these already generated items: ${previousList}. Pick a distinct concept, features, materials/ingredients, target audience, and price point. Ensure the name is clearly different.`;
        }

        if (brief) {
            const differentiators = Array.isArray(brief.differentiators)
                ? brief.differentiators.map((d: string) => `• ${d}`).join("\n")
                : "";
            const priceTier = brief.priceTier ? String(brief.priceTier) : "";
            const targetAudience = brief.targetAudience ? String(brief.targetAudience) : "";
            const nameIdea = brief.nameIdea ? String(brief.nameIdea) : "";

            prompt = `${prompt}\nBase the product strongly on this concept while keeping it realistic and not a real brand:\nName idea: ${nameIdea}\nTarget audience: ${targetAudience}\nPrice tier: ${priceTier}\nKey differentiators:\n${differentiators}`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4.1-2025-04-14",
            response_format: zodResponseFormat(schema, "product"),
        });

        try {
            if (completion.choices[0]?.message.content) {
                return JSON.parse(completion.choices[0].message.content);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async generateProductBriefs(
        category: string,
        productCount: number,
        additionalInformation: string = "",
    ): Promise<Record<string, any>[]> {
        const Brief = z.object({
            nameIdea: z.string(),
            targetAudience: z.string(),
            priceTier: z.enum(["budget", "mid", "premium"]).optional(),
            differentiators: z.array(z.string()).min(3).max(6),
        });

        let prompt = `Create ${productCount} clearly distinct product concepts (not real brands) for the industry ${category}. Each concept must have: nameIdea, targetAudience, 3-6 differentiators, and an optional priceTier among budget/mid/premium.`;
        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Consider this additional context: \"${additionalInformation}\".`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4.1-2025-04-14",
            response_format: zodResponseFormat(
                z.object({ briefs: z.array(Brief) }),
                "briefs",
            ),
        });

        try {
            if (completion.choices[0]?.message.content) {
                const parsed = JSON.parse(completion.choices[0].message.content);
                return parsed["briefs"] || [];
            }
        } catch (e) {
            console.error(e);
        }

        return [];
    }

    async generateProductImages(products: Record<string, any>[], category: string, additionalInformation: string = "") {
        console.log("Generating product images ...");

        return await Promise.all(
            products.map(async (product) => {
                return await this.generateProductImage(product, category, additionalInformation);
            }),
        );
    }

    async generateProductImage(product: Record<string, any>, category: string, additionalInformation: string = "") {
        const categoryImageDir = this.createCategoryImageDir(category);

        const imageName = product.name.replace(/[^a-zA-Z]/g, "");
        const imageFsPath = path.join(categoryImageDir, `${imageName}.png`);

        if (fs.existsSync(imageFsPath)) {
            const imageBase64 = fs.readFileSync(imageFsPath, { encoding: "base64" });

            product.image = {
                name: imageName,
                type: ".png",
                data: imageBase64,
            };

            console.log(`Image for product ${product.name} used from image cache.`);

            return product;
        }

        let prompt = `CRITICAL INSTRUCTION: Create a professional, commercial studio photograph of a photo-realistic product image. The image must be on a pristine white background with a clean, hard-edged shadow underneath the product. 
			No text, logos, or other distracting elements are allowed. The product should be captured with a high-end DSLR camera using a macro lens, set with a shallow depth of field (f/1.8). 
			The lighting is soft and even, highlighting the product's details and texture without harsh reflections. 
			The product picture should match the name ${product.name} with the product description: ${product.description} from the category ${category}.`;

        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Additional context to consider for the image styling or details: \"${additionalInformation}\".`;
        }

        let imageBase64: string = "";

        try {
            const imageResponse = await this.openAI.images.generate({
                model: "gpt-image-1",
                prompt: prompt,
                size: "1024x1024",
                n: 1,
            });

            if (imageResponse.data[0] && imageResponse.data[0]["b64_json"]) {
                imageBase64 = imageResponse.data[0]["b64_json"];
            }
        } catch (e) {
            console.warn(e);
        }

        if (!imageBase64.length) {
            return product;
        }

        if (!fs.existsSync(imageFsPath)) {
            try {
                fs.writeFileSync(imageFsPath, imageBase64, "base64");
            } catch (err) {
                console.error(err);
            }
        }

        console.log(`Image for product ${product.name} generated successfully.`);

        product.image = {
            name: imageName,
            type: ".png",
            data: imageBase64,
        };

        return product;
    }

    createCategoryImageDir(category: string): string {
        const categoryImageDir = `${this.imageDir}/${category.replace(/[^a-zA-Z]/g, "")}`;

        if (!fs.existsSync(categoryImageDir)) {
            try {
                fs.mkdirSync(categoryImageDir);
            } catch (err) {
                console.error(err);
            }
        }

        return categoryImageDir;
    }
}
